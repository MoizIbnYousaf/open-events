import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0009Sql from '../../migrations/0009_add_captured_message_submission.sql?raw'
import migration0010Sql from '../../migrations/0010_create_evaluation_tables.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
import migration0012Sql from '../../migrations/0012_add_message_kinds.sql?raw'
import app from '../../src/server'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import {
  SEEDED_TALK_ANSWERS,
  applyMigrations,
  seedDemoConf,
  splitSqlStatements,
} from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'

// O3 P4: every formerly bare-id admin surface lives under its event slug and
// the service verifies the entity belongs to that event. A guessed valid id
// under another event's slug answers exactly the same safe 404 envelope as an
// absent id — indistinguishable — and performs zero mutations. The old
// unscoped paths are gone (404), so no working unscoped alias remains.

const OTHER_EVENT_ID = 'e0000000-0000-4000-8000-00000000beef'
const NOT_FOUND_ENVELOPE = { error: { code: 'not_found', message: 'Not found' } }

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
    { name: '0007_create_speaker_task_tables.sql', queries: splitSqlStatements(migration0007Sql) },
    {
      name: '0009_add_captured_message_submission.sql',
      queries: splitSqlStatements(migration0009Sql),
    },
    { name: '0010_create_evaluation_tables.sql', queries: splitSqlStatements(migration0010Sql) },
    { name: '0011_add_form_tasks.sql', queries: splitSqlStatements(migration0011Sql) },
    { name: '0012_add_message_kinds.sql', queries: splitSqlStatements(migration0012Sql) },
  ])
  await seedDemoConf(env.DB)
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, status)
     VALUES (?, 'other-conf-2026', 'OtherConf 2026', 'UTC', 'draft')`,
  )
    .bind(OTHER_EVENT_ID)
    .run()
})

async function organizerToken(): Promise<string> {
  const { token } = await loginOrganizer()
  if (token === null) throw new Error('organizer login failed')
  return token
}

async function submitAccepted(token: string): Promise<string> {
  const speaker = await submitterCookie(env.DB)
  const draftId = await savePublicDraft(speaker, { title: 'Scope talk' })
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
        title: 'Scope talk',
        answers: SEEDED_TALK_ANSWERS,
        coSpeakers: [],
      }),
    },
    bindings(),
  )
  expect(submit.status).toBe(200)
  const submissionId = ((await submit.json()) as { id: string }).id
  const accept = await app.request(
    `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
    { method: 'POST', headers: { cookie: cookieHeader(token), origin: ALLOWED_ORIGIN } },
    bindings(),
  )
  expect(accept.status).toBe(200)
  return submissionId
}

function request(token: string, method: string, path: string, body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: {
        cookie: cookieHeader(token),
        origin: ALLOWED_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  )
}

interface Probe {
  readonly name: string
  readonly method: string
  readonly path: (slug: string, submissionId: string) => string
  readonly body?: unknown
  readonly happy?: number
}

const PROBES: readonly Probe[] = [
  {
    name: 'acceptance-preview',
    method: 'GET',
    path: (slug, id) => `/api/admin/events/${slug}/submissions/${id}/acceptance-preview`,
  },
  {
    name: 'acceptance-send',
    method: 'POST',
    path: (slug, id) => `/api/admin/events/${slug}/submissions/${id}/acceptance-send`,
  },
  {
    name: 'reminder-preview',
    method: 'GET',
    path: (slug, id) => `/api/admin/events/${slug}/submissions/${id}/reminder-preview`,
  },
  {
    name: 'reminder-send',
    method: 'POST',
    path: (slug, id) => `/api/admin/events/${slug}/submissions/${id}/reminder-send`,
  },
  {
    name: 'messages',
    method: 'GET',
    path: (slug, id) => `/api/admin/events/${slug}/submissions/${id}/messages`,
  },
  {
    name: 'form-tasks',
    method: 'POST',
    path: (slug, id) => `/api/admin/events/${slug}/submissions/${id}/form-tasks`,
    body: { formId: DEMO_CONF_2026_FORM_ID, contactId: 'contact-any' },
    happy: 404,
  },
  {
    name: 'assignments-list',
    method: 'GET',
    path: (slug, id) => `/api/admin/events/${slug}/submissions/${id}/assignments`,
  },
  {
    name: 'evaluation-summary',
    method: 'GET',
    path: (slug, id) => `/api/admin/events/${slug}/submissions/${id}/evaluation-summary`,
  },
]

describe('event-scoped submission surfaces', () => {
  it('answers identically for cross-event and absent ids, and mutates nothing', async () => {
    const token = await organizerToken()
    const submissionId = await submitAccepted(token)

    for (const probe of PROBES) {
      const happy = await request(
        token,
        probe.method,
        probe.path('demo-conf-2026', submissionId),
        probe.body,
      )
      expect(
        [200, probe.happy ?? 200].includes(happy.status),
        `${probe.name} happy path returned ${happy.status}`,
      ).toBe(true)

      const crossEvent = await request(
        token,
        probe.method,
        probe.path('other-conf-2026', submissionId),
        probe.body,
      )
      const absent = await request(
        token,
        probe.method,
        probe.path('demo-conf-2026', 'submission-does-not-exist'),
        probe.body,
      )
      expect(crossEvent.status, `${probe.name} cross-event status`).toBe(404)
      expect(absent.status, `${probe.name} absent status`).toBe(404)
      expect(await crossEvent.json(), `${probe.name} cross-event body`).toEqual(NOT_FOUND_ENVELOPE)
      expect(await absent.json(), `${probe.name} absent body`).toEqual(NOT_FOUND_ENVELOPE)
    }

    const messageCount = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM captured_messages WHERE kind != ?',
    )
      .bind('confirmation')
      .first<{ n: number }>()
    // Only the happy-path acceptance/reminder sends wrote rows (owner-only
    // audience => exactly one row each); the cross-event/absent probes wrote none.
    expect(messageCount?.n).toBe(2)
  })
})

describe('event-scoped form builder', () => {
  it('scopes draft/versions/publish reads and writes by event', async () => {
    const token = await organizerToken()
    const happy = await request(
      token,
      'GET',
      `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/versions`,
    )
    expect(happy.status).toBe(200)

    const crossEvent = await request(
      token,
      'GET',
      `/api/admin/events/other-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/versions`,
    )
    const absent = await request(
      token,
      'GET',
      `/api/admin/events/demo-conf-2026/forms/form-does-not-exist/versions`,
    )
    expect(crossEvent.status).toBe(404)
    expect(absent.status).toBe(404)
    expect(await crossEvent.json()).toEqual(NOT_FOUND_ENVELOPE)
    expect(await absent.json()).toEqual(NOT_FOUND_ENVELOPE)

    const crossPublish = await request(
      token,
      'POST',
      `/api/admin/events/other-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/publish`,
    )
    expect(crossPublish.status).toBe(404)
  })
})

describe('unscoped aliases are gone', () => {
  it('every old bare-id path answers 404', async () => {
    const token = await organizerToken()
    const submissionId = await submitAccepted(token)
    const oldPaths: ReadonlyArray<readonly [string, string]> = [
      ['GET', `/api/admin/forms/${DEMO_CONF_2026_FORM_ID}/draft`],
      ['GET', `/api/admin/forms/${DEMO_CONF_2026_FORM_ID}/versions`],
      ['POST', `/api/admin/forms/${DEMO_CONF_2026_FORM_ID}/publish`],
      ['POST', `/api/admin/submissions/${submissionId}/accept`],
      ['POST', `/api/admin/submissions/${submissionId}/form-tasks`],
      ['GET', `/api/admin/submissions/${submissionId}/acceptance-preview`],
      ['POST', `/api/admin/submissions/${submissionId}/acceptance-send`],
      ['GET', `/api/admin/submissions/${submissionId}/reminder-preview`],
      ['POST', `/api/admin/submissions/${submissionId}/reminder-send`],
      ['GET', `/api/admin/submissions/${submissionId}/messages`],
      ['GET', `/api/admin/submissions/${submissionId}/assignments`],
      ['GET', `/api/admin/submissions/${submissionId}/evaluation-summary`],
    ]
    for (const [method, path] of oldPaths) {
      const response = await request(token, method, path)
      expect(response.status, `${method} ${path}`).toBe(404)
    }
  })
})
