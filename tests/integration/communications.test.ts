import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset, type D1Migration } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
import migration0012Sql from '../../migrations/0012_add_message_kinds.sql?raw'
import migration0009Sql from '../../migrations/0009_add_captured_message_submission.sql?raw'
import app from '../../src/server'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import {
  SEEDED_WORKSHOP_ANSWERS,
  applyMigrations,
  seedDemoConf,
  splitSqlStatements,
} from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  parseCookieToken,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'

// 0007 creates submission_acceptances: the acceptance record is the
// precondition of every acceptance message, so this suite runs against the
// same schema the real product does.
const COMMUNICATION_MIGRATIONS: D1Migration[] = [
  {
    // 0006 creates agenda_sessions, which acceptance writes in the same batch.
    name: '0006_create_agenda_tables.sql',
    queries: splitSqlStatements(migration0006Sql),
  },
  {
    name: '0007_create_speaker_task_tables.sql',
    queries: splitSqlStatements(migration0007Sql),
  },
  {
    name: '0009_add_captured_message_submission.sql',
    queries: splitSqlStatements(migration0009Sql),
  },
  {
    name: '0011_add_form_tasks.sql',
    queries: splitSqlStatements(migration0011Sql),
  },
  {
    name: '0012_add_message_kinds.sql',
    queries: splitSqlStatements(migration0012Sql),
  },
]

interface CapturedMessageBody {
  readonly id: string
  readonly submissionId: string
  readonly toEmail: string
  readonly subject: string
  readonly body: string
  readonly createdAt: string
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, COMMUNICATION_MIGRATIONS)
  await seedDemoConf(env.DB)
})

/** Start + redeem for an arbitrary seeded-event speaker email. */
async function submitterCookieFor(db: D1Database, email: string): Promise<string> {
  const start = await app.request(
    '/api/public/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, eventSlug: 'demo-conf-2026', formSlug: 'cfp' }),
    },
    bindings(),
  )
  if (start.status !== 202) throw new Error(`start failed with ${start.status}`)
  const message = await db
    .prepare(
      'SELECT body FROM captured_messages WHERE to_email = ? ORDER BY created_at DESC LIMIT 1',
    )
    .bind(email)
    .first<{ body: string }>()
  if (message === null) throw new Error('no captured message found')
  const raw = decodeURIComponent(message.body.split('token=')[1] ?? '')
  const redeem = await app.request(
    `/api/public/session?token=${encodeURIComponent(raw)}`,
    undefined,
    bindings(),
  )
  const token = parseCookieToken(redeem.headers.get('set-cookie'))
  if (token === null) throw new Error('redeem set no session cookie')
  return token
}

async function createSubmission(cookie: string, title: string): Promise<string> {
  const draftId = await savePublicDraft(cookie, { title })
  const response = await app.request(
    '/api/public/submit',
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        originDraftId: draftId,
        formVersionId: DEMO_CONF_2026_VERSION_ID,
        title,
        answers: SEEDED_WORKSHOP_ANSWERS,
        coSpeakers: [],
      }),
    },
    bindings(),
  )
  if (response.status !== 200) throw new Error(`submit failed with ${response.status}`)
  const submission = (await response.json()) as { id: string }
  return submission.id
}

async function organizerRequest(method: string, path: string, token: string) {
  return app.request(
    path,
    { method, headers: { cookie: cookieHeader(token), origin: ALLOWED_ORIGIN } },
    bindings(),
  )
}

/**
 * A submission that has actually been accepted. Acceptance is a separate real
 * organizer action, so every acceptance-message case starts from the state the
 * product can genuinely be in when the message goes out.
 */
async function setup({ accept = true }: { accept?: boolean } = {}): Promise<{
  organizer: string
  submitter: string
  submissionId: string
}> {
  const submitter = await submitterCookie(env.DB)
  const submissionId = await createSubmission(submitter, 'Rust, C++; a workshop')
  const { token } = await loginOrganizer()
  if (token === null) throw new Error('organizer login set no cookie')
  if (accept) {
    const accepted = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
      token,
    )
    if (accepted.status !== 200) throw new Error(`accept failed with ${accepted.status}`)
  }
  return { organizer: token, submitter, submissionId }
}

describe('acceptance preview', () => {
  it('renders the template substitutions for the organizer', async () => {
    const { organizer, submissionId } = await setup()

    const response = await organizerRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-preview`,
      organizer,
    )

    expect(response.status).toBe(200)
    const preview = (await response.json()) as {
      subject: string
      body: string
      toEmail: string
      accepted: boolean
      alreadySent: boolean
    }
    expect(preview.subject).toContain('Rust, C++; a workshop')
    expect(preview.subject).toContain('DemoConf 2026')
    expect(preview.body).toContain('DemoConf 2026')
    expect(preview.body).not.toContain('{{')
    expect(preview.toEmail).toBe('speaker-a@example.test')
    expect(preview.alreadySent).toBe(false)
    expect(preview.accepted).toBe(true)
    expect(preview.body).not.toMatch(/attach/i)
    expect(DEMO_CONF_2026_FORM_ID.length).toBeGreaterThan(0)
  })

  it('reports that a submission with no acceptance record is not accepted', async () => {
    const { organizer, submissionId } = await setup({ accept: false })

    const response = await organizerRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-preview`,
      organizer,
    )

    expect(response.status).toBe(200)
    expect(((await response.json()) as { accepted: boolean }).accepted).toBe(false)
  })

  it('rejects an anonymous read with the error envelope', async () => {
    const { submissionId } = await setup()

    const response = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-preview`,
      undefined,
      bindings(),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' },
    })
  })

  it('returns the not_found envelope for an unknown submission', async () => {
    const { organizer } = await setup()

    const response = await organizerRequest(
      'GET',
      '/api/admin/events/demo-conf-2026/submissions/does-not-exist/acceptance-preview',
      organizer,
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })
})

describe('acceptance send idempotency and history immutability', () => {
  // O2 updated this contract: acceptance-send answers one stored row per
  // resolved recipient. This journey has no co-speakers, so the audience is
  // exactly the owner and the once-only rule still means one stored row.
  it('writes exactly one immutable captured message across repeated sends', async () => {
    const { organizer, submissionId } = await setup()

    const first = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-send`,
      organizer,
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as CapturedMessageBody[]
    expect(firstBody).toHaveLength(1)

    const second = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-send`,
      organizer,
    )
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(firstBody)

    const history = await organizerRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/messages`,
      organizer,
    )
    expect(history.status).toBe(200)
    const rows = (await history.json()) as CapturedMessageBody[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(firstBody[0])

    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM captured_messages WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ total: number }>()
    expect(stored?.total).toBe(1)
  })

  it('reports alreadySent in the preview after the send', async () => {
    const { organizer, submissionId } = await setup()

    await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-send`,
      organizer,
    )
    const preview = await organizerRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-preview`,
      organizer,
    )

    expect(((await preview.json()) as { alreadySent: boolean }).alreadySent).toBe(true)
  })

  it('refuses a send without the origin allowlist (CSRF gate)', async () => {
    const { organizer, submissionId } = await setup()

    const response = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-send`,
      { method: 'POST', headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } })
  })

  it('refuses to send an acceptance for a submission that was never accepted', async () => {
    const { organizer, submissionId } = await setup({ accept: false })

    const response = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-send`,
      organizer,
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'conflict', message: 'Conflict' } })
    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM captured_messages WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ total: number }>()
    expect(stored?.total).toBe(0)
  })

  it('returns an empty history before any send', async () => {
    const { organizer, submissionId } = await setup()

    const response = await organizerRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/messages`,
      organizer,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})

describe('calendar invite ownership boundary', () => {
  it('serves the owning submitter a parseable text/calendar attachment', async () => {
    const { submitter, submissionId } = await setup()

    const response = await app.request(
      `/api/public/invite/${submissionId}.ics`,
      { headers: { cookie: cookieHeader(submitter) } },
      bindings(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/calendar')
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(response.headers.get('content-disposition')).toContain('.ics')

    const ics = await response.text()
    const lines: string[] = []
    for (const raw of ics.split('\r\n')) {
      if (raw.startsWith(' ') && lines.length > 0) {
        lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''}${raw.slice(1)}`
        continue
      }
      lines.push(raw)
    }
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('BEGIN:VEVENT')
    expect(lines).toContain(`UID:${submissionId}@open-events`)
    expect(lines).toContain('DTSTART:20260513T080000Z')
    expect(lines).toContain('DTEND:20260515T170000Z')
    expect(lines).toContain('SUMMARY:Rust\\, C++\\; a workshop')
  })

  it('returns 404 for a submitter who does not own the submission', async () => {
    const { submissionId } = await setup()
    const other = await submitterCookieFor(env.DB, 'speaker-b@example.test')

    const response = await app.request(
      `/api/public/invite/${submissionId}.ics`,
      { headers: { cookie: cookieHeader(other) } },
      bindings(),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('rejects an anonymous request and an organizer session', async () => {
    const { organizer, submissionId } = await setup()

    const anonymous = await app.request(
      `/api/public/invite/${submissionId}.ics`,
      undefined,
      bindings(),
    )
    expect(anonymous.status).toBe(401)

    const asOrganizer = await app.request(
      `/api/public/invite/${submissionId}.ics`,
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    expect(asOrganizer.status).toBe(403)
  })

  it('returns 404 for an unknown submission id', async () => {
    const { submitter } = await setup()

    const response = await app.request(
      '/api/public/invite/does-not-exist.ics',
      { headers: { cookie: cookieHeader(submitter) } },
      bindings(),
    )

    expect(response.status).toBe(404)
  })
})
