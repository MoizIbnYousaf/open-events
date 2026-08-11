import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0009Sql from '../../migrations/0009_add_captured_message_submission.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
import migration0012Sql from '../../migrations/0012_add_message_kinds.sql?raw'
import app from '../../src/server'
import { DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { applyMigrations, seedDemoConf, splitSqlStatements } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'

// O2 storage contract (REQ-010): captured messages carry a real kind
// (confirmation | acceptance | reminder), acceptance and reminder rows for
// one submission coexist, and repeating the same kind for the same recipient
// is a storage-level conflict — the once-only rule survives retries and
// concurrency because the database enforces it, not just the service.
// Pre-0012 rows survive: submission-linked rows backfill to acceptance and
// unlinked confirmation captures keep kind=confirmation with null submission.

const EXTRA_MIGRATIONS = [
  { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
  { name: '0007_create_speaker_task_tables.sql', queries: splitSqlStatements(migration0007Sql) },
  {
    name: '0009_add_captured_message_submission.sql',
    queries: splitSqlStatements(migration0009Sql),
  },
  { name: '0011_add_form_tasks.sql', queries: splitSqlStatements(migration0011Sql) },
]

const MIGRATION_0012 = {
  name: '0012_add_message_kinds.sql',
  queries: splitSqlStatements(migration0012Sql),
}

const NOW = '2026-08-10T09:00:00.000Z'
const EVENT_ID = DEMO_CONF_2026_ID

async function insertLegacyRow(id: string, submissionId: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO captured_messages (id, event_id, to_email, subject, body, created_at, submission_id)
     VALUES (?, ?, 'ada@example.test', 'Subject', 'Body', ?, ?)`,
  )
    .bind(id, EVENT_ID, NOW, submissionId)
    .run()
}

async function insertSubmission(id: string): Promise<void> {
  // Minimal accepted-submission scaffolding is unnecessary for the storage
  // contract: captured_messages validates the event/submission pairing in the
  // application layer (0009 note), so a bare submission id string suffices.
  await Promise.resolve(id)
}

async function insertKindRow(
  id: string,
  submissionId: string | null,
  kind: string,
  toEmail = 'ada@example.test',
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO captured_messages
       (id, event_id, to_email, subject, body, created_at, submission_id, kind)
     VALUES (?, ?, ?, 'Subject', 'Body', ?, ?, ?)`,
  )
    .bind(id, EVENT_ID, toEmail, NOW, submissionId, kind)
    .run()
}

describe('migration 0012 backfill', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await applyD1Migrations(env.DB, EXTRA_MIGRATIONS)
    await seedDemoConf(env.DB)
  })

  it('backfills submission-linked rows to acceptance and unlinked rows to confirmation', async () => {
    await insertLegacyRow('message-start', null)
    await insertLegacyRow('message-acceptance', 'submission-legacy')
    await applyD1Migrations(env.DB, [MIGRATION_0012])

    const rows = await env.DB.prepare(
      'SELECT id, kind, submission_id FROM captured_messages ORDER BY id',
    ).all<{ id: string; kind: string; submission_id: string | null }>()
    expect(rows.results).toEqual([
      { id: 'message-acceptance', kind: 'acceptance', submission_id: 'submission-legacy' },
      { id: 'message-start', kind: 'confirmation', submission_id: null },
    ])
  })
})

describe('per-kind per-recipient idempotency constraint', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await applyD1Migrations(env.DB, [...EXTRA_MIGRATIONS, MIGRATION_0012])
    await seedDemoConf(env.DB)
    await insertSubmission('submission-1')
  })

  it('lets acceptance and reminder coexist for one submission and recipient', async () => {
    await insertKindRow('message-1', 'submission-1', 'acceptance')
    await insertKindRow('message-2', 'submission-1', 'reminder')
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM captured_messages WHERE submission_id = 'submission-1'",
    ).first<{ n: number }>()
    expect(count?.n).toBe(2)
  })

  it('lets one kind reach several recipients of the same submission', async () => {
    await insertKindRow('message-1', 'submission-1', 'acceptance', 'ada@example.test')
    await insertKindRow('message-2', 'submission-1', 'acceptance', 'grace@example.test')
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM captured_messages WHERE kind = 'acceptance'",
    ).first<{ n: number }>()
    expect(count?.n).toBe(2)
  })

  it('rejects a duplicate of the same kind for the same submission and recipient', async () => {
    await insertKindRow('message-1', 'submission-1', 'acceptance')
    await expect(insertKindRow('message-2', 'submission-1', 'acceptance')).rejects.toThrow(
      /UNIQUE|constraint/i,
    )
  })

  it('rejects an unknown kind', async () => {
    await expect(insertKindRow('message-x', 'submission-1', 'newsletter')).rejects.toThrow(
      /CHECK|constraint/i,
    )
  })

  it('keeps unlinked confirmation rows unconstrained across repeats', async () => {
    await insertKindRow('message-1', null, 'confirmation')
    await insertKindRow('message-2', null, 'confirmation')
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM captured_messages WHERE submission_id IS NULL',
    ).first<{ n: number }>()
    expect(count?.n).toBe(2)
  })
})

interface MessageBody {
  readonly id: string
  readonly kind: string
  readonly toEmail: string
}

interface PreviewBody {
  readonly kind: string
  readonly subject: string
  readonly alreadySent: boolean
  readonly audience: ReadonlyArray<{ readonly email: string; readonly alreadySent: boolean }>
}

async function organizerRequest(method: string, path: string, token: string) {
  return app.request(
    path,
    { method, headers: { cookie: cookieHeader(token), origin: ALLOWED_ORIGIN } },
    bindings(),
  )
}

describe('reminder routes and audience fan-out', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await applyD1Migrations(env.DB, [...EXTRA_MIGRATIONS, MIGRATION_0012])
    await seedDemoConf(env.DB)
  })

  async function acceptedWithCoSpeaker(): Promise<{ organizer: string; submissionId: string }> {
    const speaker = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(speaker, { title: 'Fan-out talk' })
    const submit = await app.request(
      '/api/public/submit',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          originDraftId: draftId,
          formVersionId: DEMO_CONF_2026_VERSION_ID,
          title: 'Fan-out talk',
          answers: { format: 'talk' },
          coSpeakers: [{ name: 'Speaker B', email: 'Speaker-B@Example.Test' }],
        }),
      },
      bindings(),
    )
    expect(submit.status).toBe(200)
    const submissionId = ((await submit.json()) as { id: string }).id
    const { token } = await loginOrganizer()
    if (token === null) throw new Error('organizer login failed')
    const accepted = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
      token,
    )
    expect(accepted.status).toBe(200)
    return { organizer: token, submissionId }
  }

  it('acceptance send fans out to owner plus normalized co-speaker exactly once', async () => {
    const { organizer, submissionId } = await acceptedWithCoSpeaker()
    const send = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-send`,
      organizer,
    )
    expect(send.status).toBe(200)
    const rows = (await send.json()) as MessageBody[]
    expect(rows.map((row) => row.toEmail).sort()).toEqual([
      'speaker-a@example.test',
      'speaker-b@example.test',
    ])
    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM captured_messages WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ n: number }>()
    expect(stored?.n).toBe(2)
  })

  it('concurrent duplicate sends resolve to the stored winners, never a 500 or extra row', async () => {
    const { organizer, submissionId } = await acceptedWithCoSpeaker()
    const path = `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-send`
    const [a, b] = await Promise.all([
      organizerRequest('POST', path, organizer),
      organizerRequest('POST', path, organizer),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const bodyA = (await a.json()) as MessageBody[]
    const bodyB = (await b.json()) as MessageBody[]
    expect(new Set(bodyA.map((row) => row.id))).toEqual(new Set(bodyB.map((row) => row.id)))
    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM captured_messages WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ n: number }>()
    expect(stored?.n).toBe(2)
  })

  it('reminder previews the audience, sends once, and coexists with acceptance in history', async () => {
    const { organizer, submissionId } = await acceptedWithCoSpeaker()
    const preview = await organizerRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/reminder-preview`,
      organizer,
    )
    expect(preview.status).toBe(200)
    const previewBody = (await preview.json()) as PreviewBody
    expect(previewBody.kind).toBe('reminder')
    expect(previewBody.alreadySent).toBe(false)
    expect(previewBody.audience.map((recipient) => recipient.email).sort()).toEqual([
      'speaker-a@example.test',
      'speaker-b@example.test',
    ])

    await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/acceptance-send`,
      organizer,
    )
    const send = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/reminder-send`,
      organizer,
    )
    expect(send.status).toBe(200)
    const repeat = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/reminder-send`,
      organizer,
    )
    expect(repeat.status).toBe(200)
    expect(await repeat.json()).toEqual(await send.clone().json())

    const history = await organizerRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/messages`,
      organizer,
    )
    const rows = (await history.json()) as MessageBody[]
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(['acceptance', 'reminder']))
  })

  it('refuses a reminder without CSRF origin and for a never-accepted submission', async () => {
    const speaker = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(speaker, { title: 'Unaccepted talk' })
    const submit = await app.request(
      '/api/public/submit',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          originDraftId: draftId,
          formVersionId: DEMO_CONF_2026_VERSION_ID,
          title: 'Unaccepted talk',
          answers: { format: 'talk' },
          coSpeakers: [],
        }),
      },
      bindings(),
    )
    const submissionId = ((await submit.json()) as { id: string }).id
    const { token } = await loginOrganizer()
    if (token === null) throw new Error('organizer login failed')

    const noCsrf = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/reminder-send`,
      { method: 'POST', headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(noCsrf.status).toBe(403)

    const conflict = await organizerRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/reminder-send`,
      token,
    )
    expect(conflict.status).toBe(409)
    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM captured_messages WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ n: number }>()
    expect(stored?.n).toBe(0)
  })
})
