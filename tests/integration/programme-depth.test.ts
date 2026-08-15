import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import app from '../../src/server'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  submitterCookie,
} from './m2c-helpers'

const NOW = '2026-01-01T12:00:00.000Z'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function organizerCookie(): Promise<string> {
  return (await loginOrganizer()).token ?? ''
}

describe('multi-event, speakers, embeds, and auto-place', () => {
  it('creates a second event and keeps it off the first event roster', async () => {
    const cookie = await organizerCookie()
    const created = await app.request(
      '/api/admin/events',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Forward Summit 2028' }),
      },
      bindings(),
    )
    expect(created.status).toBe(201)
    const event = (await created.json()) as { slug: string; name: string }
    expect(event.name).toBe('Forward Summit 2028')
    expect(event.slug).toBe('forward-summit-2028')

    const list = await app.request(
      '/api/admin/events',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    const events = (await list.json()) as Array<{ slug: string }>
    expect(events.map((row) => row.slug).sort()).toEqual(['demo-conf-2026', 'forward-summit-2028'])

    const submissions = await app.request(
      `/api/admin/events/${event.slug}/submissions`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(submissions.status).toBe(200)
    const rows = (await submissions.json()) as unknown[]
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toHaveLength(0)
  })

  it('lets an organizer add a speaker and read them back on the roster', async () => {
    const cookie = await organizerCookie()
    const added = await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Dana Kowalski',
          email: 'dana@example.test',
          bio: 'Imported speaker',
          jobTitle: 'Engineer',
          company: 'Northwind',
        }),
      },
      bindings(),
    )
    expect(added.status).toBe(201)
    const person = (await added.json()) as { name: string; email: string; jobTitle: string }
    expect(person.name).toBe('Dana Kowalski')
    expect(person.email).toBe('dana@example.test')
    expect(person.jobTitle).toBe('Engineer')

    const roster = await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    const people = (await roster.json()) as Array<{ email: string }>
    expect(people.some((row) => row.email === 'dana@example.test')).toBe(true)
  })

  it('saves an embed and serves the public snippet page', async () => {
    const cookie = await organizerCookie()
    const created = await app.request(
      '/api/admin/events/demo-conf-2026/embeds',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Sessions list', kind: 'sessions', format: 'html' }),
      },
      bindings(),
    )
    expect(created.status).toBe(201)
    const embed = (await created.json()) as { id: string; snippet: string }
    expect(embed.snippet).toContain('/embed/')

    const page = await app.request(`/embed/${embed.id}`, undefined, bindings())
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toMatch(/text\/html/)
    expect(await page.text()).toContain('Sessions list')
  })

  it('places an unplaced accepted session when auto-place runs', async () => {
    await env.DB.prepare(
      `INSERT INTO contacts (id, email, name, created_at) VALUES ('c-place', 'place@example.test', 'Pat Place', ?)`,
    )
      .bind(NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO proposal_submissions (id, event_id, owner_contact_id, form_version_id,
         origin_draft_id, status, title, answers_json, content_hash, routing_json, created_at, submitted_at)
       VALUES ('sub-place', 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'c-place',
         'f0000000-0000-4000-8000-000000000002', 'draft-place', 'pending', 'Unplaced talk',
         '{"format":"Talk","abstract":"Hello"}', ?, NULL, ?, ?)`,
    )
      .bind('a'.repeat(64), NOW, NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO submission_acceptances (event_id, submission_id, accepted_at)
       VALUES ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'sub-place', ?)`,
    )
      .bind(NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO agenda_sessions (event_id, submission_id, track_id, room_id, day, start, end,
         position, status, assignment, created_at, updated_at)
       VALUES ('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', 'sub-place', NULL, NULL,
         '2026-05-13', '2026-05-13T09:00:00.000Z', '2026-05-13T10:00:00.000Z',
         0, 'draft', 'unassigned', ?, ?)`,
    )
      .bind(NOW, NOW)
      .run()

    const cookie = await organizerCookie()
    const placed = await app.request(
      '/api/admin/events/demo-conf-2026/agenda/auto-place',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
      bindings(),
    )
    expect(placed.status).toBe(200)
    const result = (await placed.json()) as { placedCount: number }
    expect(result.placedCount).toBeGreaterThanOrEqual(1)
  })

  it('persists an organizer bio edit and travel notes across a reload', async () => {
    const cookie = await organizerCookie()
    const added = await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Priya Raman',
          email: 'priya@example.test',
          bio: 'Original bio',
        }),
      },
      bindings(),
    )
    expect(added.status).toBe(201)
    const person = (await added.json()) as { contactId: string }
    const patched = await app.request(
      `/api/admin/events/demo-conf-2026/speakers/${person.contactId}`,
      {
        method: 'PATCH',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          bio: 'SBEK-ORG-EDIT-01',
          travelNotes: 'Prefers aisle. Arrives 12 May.',
        }),
      },
      bindings(),
    )
    expect(patched.status).toBe(200)
    const roster = await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    const people = (await roster.json()) as Array<{
      contactId: string
      bio: string | null
      travelNotes: string
    }>
    const saved = people.find((row) => row.contactId === person.contactId)
    expect(saved?.bio).toBe('SBEK-ORG-EDIT-01')
    expect(saved?.travelNotes).toBe('Prefers aisle. Arrives 12 May.')
  })

  it('sends a welcome broadcast and lists it in the event message log', async () => {
    const cookie = await organizerCookie()
    await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Dana Kowalski', email: 'dana-mail@example.test' }),
      },
      bindings(),
    )
    const sent = await app.request(
      '/api/admin/events/demo-conf-2026/speakers/broadcast',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subject: 'Welcome to {{eventName}} speakers',
          body: 'Hi {{name}}, portal {{portalLink}}',
          contactIds: [],
        }),
      },
      bindings(),
    )
    expect(sent.status).toBe(200)
    const payload = (await sent.json()) as { sent: number }
    expect(payload.sent).toBeGreaterThanOrEqual(1)
    const log = await app.request(
      '/api/admin/events/demo-conf-2026/messages',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    const messages = (await log.json()) as Array<{ subject: string; body: string }>
    expect(messages.some((row) => row.subject.includes('speakers'))).toBe(true)
    expect(messages.some((row) => row.body.includes('/portal'))).toBe(true)
  })

  it('creates a file-request task, then lists it for organizer and speaker', async () => {
    const cookie = await organizerCookie()
    const added = await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Priya Raman', email: 'priya.files@example.test' }),
      },
      bindings(),
    )
    expect(added.status).toBe(201)
    const priya = (await added.json()) as { contactId: string }
    const speaker = await submitterCookie(env.DB, {}, 'priya.files@example.test')

    const created = await app.request(
      '/api/admin/events/demo-conf-2026/assignments',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Upload Session Presentation',
          dueAt: '2027-05-01',
          kind: 'file_request',
          instructions: 'PDF slides only',
          contactIds: [priya!.contactId],
        }),
      },
      bindings(),
    )
    expect(created.status).toBe(201)

    const listed = await app.request(
      '/api/admin/events/demo-conf-2026/assignments',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    const tasks = (await listed.json()) as Array<{ title: string; kind: string; dueAt: string }>
    expect(
      tasks.some(
        (row) => row.title === 'Upload Session Presentation' && row.kind === 'file_request',
      ),
    ).toBe(true)

    const mine = await app.request(
      '/api/public/assignments',
      { headers: { cookie: cookieHeader(speaker) } },
      bindings(),
    )
    expect(mine.status).toBe(200)
    const own = (await mine.json()) as Array<{
      title: string
      status: string
      dueAt: string | null
    }>
    expect(
      own.some((row) => row.title === 'Upload Session Presentation' && row.status === 'pending'),
    ).toBe(true)

    const upload = await app.request(
      '/api/public/profile/document',
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/pdf',
          'x-file-name': 'slides.pdf',
        },
        body: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
      },
      bindings(),
    )
    expect(upload.status).toBe(200)

    const versions = await app.request(
      '/api/public/files/document/versions',
      { headers: { cookie: cookieHeader(speaker) } },
      bindings(),
    )
    expect(versions.status).toBe(200)
    const versionRows = (await versions.json()) as Array<{ current: boolean; fileName: string }>
    expect(versionRows.some((row) => row.current && row.fileName === 'slides.pdf')).toBe(true)

    const commented = await app.request(
      '/api/public/files/document/comments',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body: 'Draft deck - final version coming Friday.' }),
      },
      bindings(),
    )
    expect(commented.status).toBe(201)
    const thread = await app.request(
      '/api/public/files/document/comments',
      { headers: { cookie: cookieHeader(speaker) } },
      bindings(),
    )
    const comments = (await thread.json()) as Array<{ body: string }>
    expect(comments.some((row) => row.body.includes('Draft deck'))).toBe(true)
  })
})
