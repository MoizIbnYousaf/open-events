import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import app from '../../src/server'
import { createDirectSessionUnitOfWork } from '../../src/db/direct-session-unit-of-work'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  parseCookieToken,
} from './m2c-helpers'

const PATH = '/api/admin/events/demo-conf-2026/direct-sessions'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
  await env.DB.prepare(
    `INSERT INTO speaker_profiles
       (event_id, contact_id, job_title, company, travel_notes, workflow_status, created_at, updated_at)
     SELECT e.id, c.id, '', '', '', 'invited', '2026-05-01T09:00:00.000Z', '2026-05-01T09:00:00.000Z'
       FROM events e, contacts c
      WHERE e.slug = 'demo-conf-2026' AND c.email = 'speaker.ada@example.test'`,
  ).run()
})

async function organizer(): Promise<string> {
  const result = await loginOrganizer()
  if (result.token === null) throw new Error('organizer login failed')
  return result.token
}

async function speakerId(): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT sp.contact_id AS id
       FROM speaker_profiles sp
       JOIN events e ON e.id = sp.event_id
      WHERE e.slug = 'demo-conf-2026'
      ORDER BY sp.contact_id LIMIT 1`,
  ).first<{ id: string }>()
  if (row === null) throw new Error('showcase has no speaker')
  return row.id
}

async function create(token: string, overrides: Record<string, unknown> = {}): Promise<Response> {
  return app.request(
    PATH,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(token),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        requestId: 'direct-request-1',
        speakerContactId: await speakerId(),
        title: 'Opening keynote',
        abstract: 'A direct programme session.',
        formatId: 'f0000000-0000-4000-8000-000000000501',
        trackId: 'f0000000-0000-4000-8000-000000000503',
        durationMinutes: 45,
        notes: 'Sponsor commitment',
        ...overrides,
      }),
    },
    bindings(),
  )
}

describe('direct invited sessions', () => {
  it('atomically creates the accepted programme spine and exactly replays a retry', async () => {
    const token = await organizer()
    const [first, second] = await Promise.all([create(token), create(token)])
    expect([first.status, second.status].sort()).toEqual([200, 201])
    const firstBody = (await first.json()) as { submissionId: string; created: boolean }
    const secondBody = (await second.json()) as { submissionId: string; created: boolean }
    expect(firstBody.submissionId).toBe(secondBody.submissionId)
    expect([firstBody.created, secondBody.created].sort()).toEqual([false, true])

    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM proposal_submissions WHERE source = 'direct') AS submissions,
         (SELECT COUNT(*) FROM submission_contributors WHERE submission_id = ?) AS contributors,
         (SELECT COUNT(*) FROM submission_acceptances WHERE submission_id = ?) AS acceptances,
         (SELECT COUNT(*) FROM submission_decisions WHERE submission_id = ? AND outcome = 'accepted') AS decisions,
         (SELECT COUNT(*) FROM speaker_tasks WHERE submission_id = ?) AS tasks,
         (SELECT COUNT(*) FROM agenda_sessions WHERE submission_id = ?) AS agenda,
         (SELECT COUNT(*) FROM agenda_session_speakers WHERE submission_id = ?) AS speakers`,
    )
      .bind(
        firstBody.submissionId,
        firstBody.submissionId,
        firstBody.submissionId,
        firstBody.submissionId,
        firstBody.submissionId,
        firstBody.submissionId,
      )
      .first<Record<string, number>>()
    expect(counts).toMatchObject({
      submissions: 1,
      contributors: 1,
      acceptances: 1,
      decisions: 1,
      tasks: 3,
      agenda: 1,
      speakers: 1,
    })
    const changedRetry = await create(token, { title: 'Changed retry' })
    expect(changedRetry.status).toBe(409)
    const stored = await env.DB.prepare(
      "SELECT title FROM proposal_submissions WHERE origin_draft_id = 'direct-request-1'",
    ).first<{ title: string }>()
    expect(stored?.title).toBe('Opening keynote')
  })

  it('rolls back the whole batch when a late agenda foreign key fails', async () => {
    const contactId = await speakerId()
    const unit = createDirectSessionUnitOfWork(env.DB)
    await expect(
      unit.execute({
        eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
        formId: 'direct-form-rollback',
        versionId: 'direct-version-rollback',
        requestId: 'direct-rollback',
        submissionId: 'direct-submission-rollback',
        speakerContactId: contactId,
        title: 'Rollback session',
        answers: { abstract: 'Rollback', format: 'Workshop' },
        contentHash: 'b'.repeat(64),
        submittedAt: '2026-05-01T10:00:00.000Z',
        decisionId: 'direct-decision-rollback',
        tasks: [
          {
            id: 'direct-task-rollback',
            eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
            submissionId: 'direct-submission-rollback',
            contactId,
            kind: 'confirm_participation',
            status: 'pending',
            position: 0,
            createdAt: '2026-05-01T10:00:00.000Z',
            completedAt: null,
            formId: null,
            formVersionId: null,
            response: null,
          },
        ],
        session: {
          day: '2026-05-13',
          start: '2026-05-13T10:00:00.000Z',
          end: '2026-05-13T10:45:00.000Z',
          trackId: 'missing-track',
        },
      }),
    ).rejects.toThrow()
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM proposal_submissions WHERE origin_draft_id = 'direct-rollback') AS submissions,
         (SELECT COUNT(*) FROM cfp_forms WHERE id = 'direct-form-rollback') AS forms,
         (SELECT COUNT(*) FROM speaker_tasks WHERE submission_id = 'direct-submission-rollback') AS tasks`,
    ).first<Record<string, number>>()
    expect(counts).toEqual({ submissions: 0, forms: 0, tasks: 0 })
  })

  it('rejects invalid speaker, taxonomy, duration, and tour authority with zero writes', async () => {
    const token = await organizer()
    expect((await create(token, { speakerContactId: 'not-on-event' })).status).toBe(404)
    expect((await create(token, { formatId: 'not-a-format' })).status).toBe(400)
    expect((await create(token, { durationMinutes: 0 })).status).toBe(400)

    const tour = await app.request(
      '/api/tour/session',
      {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ access: 'organizer' }),
      },
      bindings(),
    )
    const tourToken = tour.headers.get('set-cookie')?.match(/sp_tour_session=([^;]+)/)?.[1] ?? ''
    const denied = await app.request(
      PATH,
      {
        method: 'POST',
        headers: {
          cookie: `sp_tour_session=${tourToken}`,
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: 'tour-direct',
          speakerContactId: await speakerId(),
          title: 'No write',
          abstract: 'No write',
          formatId: 'f0000000-0000-4000-8000-000000000501',
          trackId: null,
          durationMinutes: 45,
          notes: '',
        }),
      },
      bindings(),
    )
    expect(denied.status).toBe(403)
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM proposal_submissions WHERE source = 'direct'",
    ).first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it('keeps direct sessions out of the CFP submission list while the agenda includes them', async () => {
    const token = await organizer()
    const created = await create(token)
    expect(created.status).toBe(201)
    const receipt = (await created.json()) as { submissionId: string }

    const submissions = await app.request(
      '/api/admin/events/demo-conf-2026/submissions',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(submissions.status).toBe(200)
    expect(JSON.stringify(await submissions.json())).not.toContain(receipt.submissionId)

    const forms = await app.request(
      '/api/admin/events/demo-conf-2026/forms',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(forms.status).toBe(200)
    expect(JSON.stringify(await forms.json())).not.toContain('__open_events_direct_sessions__')
    const hiddenPublicForm = await app.request(
      '/api/public/cfp/demo-conf-2026/__open_events_direct_sessions__',
      undefined,
      bindings(),
    )
    expect(hiddenPublicForm.status).toBe(404)

    const agenda = await app.request(
      '/api/admin/events/demo-conf-2026/agenda',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(agenda.status).toBe(200)
    expect(await agenda.json()).toMatchObject({
      sessions: [expect.objectContaining({ submissionId: receipt.submissionId, source: 'direct' })],
    })
    const roster = await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(roster.status).toBe(200)
    expect(await roster.json()).toContainEqual(
      expect.objectContaining({ contactId: await speakerId(), proposalCount: 0, sessionCount: 1 }),
    )
  })

  it('uses the existing purpose-bound speaker invite and portal lifecycle', async () => {
    const token = await organizer()
    const contactId = await speakerId()
    const created = await create(token)
    const receipt = (await created.json()) as { submissionId: string }
    const invite = await app.request(
      `/api/admin/events/demo-conf-2026/speakers/${contactId}/invite`,
      { method: 'POST', headers: { cookie: cookieHeader(token), origin: ALLOWED_ORIGIN } },
      bindings(),
    )
    expect(invite.status).toBe(200)
    const invitePath = ((await invite.json()) as { invitePath: string }).invitePath
    const redeemed = await app.request(invitePath, undefined, bindings())
    const portalToken = parseCookieToken(redeemed.headers.get('set-cookie'))
    expect(portalToken).not.toBeNull()
    const portal = await app.request(
      '/api/public/submissions',
      { headers: { cookie: cookieHeader(portalToken ?? '') } },
      bindings(),
    )
    expect(portal.status).toBe(200)
    expect(await portal.json()).toMatchObject({
      submissions: [
        expect.objectContaining({
          id: receipt.submissionId,
          source: 'direct',
          decision: 'accepted',
        }),
      ],
    })
  })
})
