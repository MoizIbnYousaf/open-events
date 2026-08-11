import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
import app from '../../src/server'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { applyMigrations, seedDemoConf, splitSqlStatements } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'

// O1 API contract: the organizer assigns the event's published form to one
// accepted speaker as a form-backed onboarding task; the speaker reads the
// real form definition for that task and completes it only with answers that
// validate against the pinned published version. The persisted response and
// readiness reflect validated completion only. All access is owner/event
// scoped and fails closed as 404.

const SPEAKER_EMAIL = 'speaker-a@example.test'
const CO_SPEAKER_EMAIL = 'speaker-b@example.test'

interface FormTaskBody {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly formId: string | null
  readonly formVersionId: string | null
  readonly response: Record<string, unknown> | null
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
    { name: '0007_create_speaker_task_tables.sql', queries: splitSqlStatements(migration0007Sql) },
    { name: '0011_add_form_tasks.sql', queries: splitSqlStatements(migration0011Sql) },
  ])
  await seedDemoConf(env.DB)
})

async function submitProposal(cookie: string): Promise<string> {
  const draftId = await savePublicDraft(cookie)
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
        title: 'Workshop proposal',
        answers: { format: 'talk' },
        coSpeakers: [{ name: 'Speaker B', email: CO_SPEAKER_EMAIL }],
      }),
    },
    bindings(),
  )
  if (response.status !== 200) throw new Error(`submit failed with ${response.status}`)
  return ((await response.json()) as { id: string }).id
}

async function acceptAndAssign(): Promise<{
  readonly speaker: string
  readonly organizer: string
  readonly submissionId: string
  readonly task: FormTaskBody
}> {
  const speaker = await submitterCookie(env.DB)
  const submissionId = await submitProposal(speaker)
  const login = await loginOrganizer()
  if (login.token === null) throw new Error('organizer login failed')
  const organizer = login.token
  const accept = await app.request(
    `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
    { method: 'POST', headers: { cookie: cookieHeader(organizer), origin: ALLOWED_ORIGIN } },
    bindings(),
  )
  expect(accept.status).toBe(200)
  const contact = await env.DB.prepare('SELECT id FROM contacts WHERE email = ?')
    .bind(SPEAKER_EMAIL)
    .first<{ id: string }>()
  if (contact === null) throw new Error('no owner contact')
  const assign = await app.request(
    `/api/admin/events/demo-conf-2026/submissions/${submissionId}/form-tasks`,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(organizer),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ formId: DEMO_CONF_2026_FORM_ID, contactId: contact.id }),
    },
    bindings(),
  )
  expect(assign.status).toBe(200)
  const task = (await assign.json()) as FormTaskBody
  return { speaker, organizer, submissionId, task }
}

async function completeTask(
  cookie: string,
  taskId: string,
  answers?: Record<string, unknown>,
): Promise<Response> {
  return app.request(
    `/api/public/tasks/${taskId}/complete`,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        ...(answers === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(answers === undefined ? {} : { body: JSON.stringify({ answers }) }),
    },
    bindings(),
  )
}

describe('migration 0011', () => {
  it('records itself and extends speaker_tasks with the form columns', async () => {
    const migration = await env.DB.prepare(
      "SELECT name FROM d1_migrations WHERE name = '0011_add_form_tasks.sql'",
    ).first<{ name: string }>()
    expect(migration).toEqual({ name: '0011_add_form_tasks.sql' })
    const columns = await env.DB.prepare('PRAGMA table_info(speaker_tasks)').all<{
      name: string
    }>()
    const names = columns.results.map((column) => column.name)
    expect(names).toEqual(expect.arrayContaining(['form_id', 'form_version_id', 'response']))
  })
})

describe('organizer form-task assignment', () => {
  it('creates a form-backed task pinned to the published version, idempotently', async () => {
    const { organizer, submissionId, task } = await acceptAndAssign()
    expect(task.kind).toBe('complete_form')
    expect(task.status).toBe('pending')
    expect(task.formId).toBe(DEMO_CONF_2026_FORM_ID)
    expect(task.formVersionId).toBe(DEMO_CONF_2026_VERSION_ID)
    expect(task.response).toBeNull()

    const contact = await env.DB.prepare('SELECT id FROM contacts WHERE email = ?')
      .bind(SPEAKER_EMAIL)
      .first<{ id: string }>()
    const again = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/form-tasks`,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ formId: DEMO_CONF_2026_FORM_ID, contactId: contact?.id }),
      },
      bindings(),
    )
    expect(again.status).toBe(200)
    expect(((await again.json()) as FormTaskBody).id).toBe(task.id)
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM speaker_tasks WHERE kind = 'complete_form'",
    ).first<{ n: number }>()
    expect(count?.n).toBe(1)
  })

  it('rejects assignment from an anonymous caller', async () => {
    const { submissionId } = await acceptAndAssign()
    const response = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/form-tasks`,
      {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ formId: DEMO_CONF_2026_FORM_ID, contactId: 'contact-x' }),
      },
      bindings(),
    )
    expect(response.status).toBe(401)
  })
})

describe('speaker form read and completion', () => {
  it('lists the form task and serves its real form definition to the owner only', async () => {
    const { speaker, task } = await acceptAndAssign()
    const list = await app.request(
      '/api/public/tasks',
      { headers: { cookie: cookieHeader(speaker) } },
      bindings(),
    )
    expect(list.status).toBe(200)
    const tasks = (await list.json()) as readonly FormTaskBody[]
    const formTask = tasks.find((item) => item.kind === 'complete_form')
    expect(formTask?.id).toBe(task.id)
    expect(formTask?.formVersionId).toBe(DEMO_CONF_2026_VERSION_ID)

    const definition = await app.request(
      `/api/public/tasks/${task.id}/form`,
      { headers: { cookie: cookieHeader(speaker) } },
      bindings(),
    )
    expect(definition.status).toBe(200)
    const body = (await definition.json()) as {
      readonly elements: ReadonlyArray<{ readonly fieldKey: string | null }>
    }
    expect(body.elements.map((element) => element.fieldKey)).toContain('format')

    const stranger = await submitterCookie(env.DB, {}, CO_SPEAKER_EMAIL)
    const denied = await app.request(
      `/api/public/tasks/${task.id}/form`,
      { headers: { cookie: cookieHeader(stranger) } },
      bindings(),
    )
    expect(denied.status).toBe(404)
  })

  it('rejects completion without answers and with invalid answers, staying pending', async () => {
    const { speaker, task } = await acceptAndAssign()
    const missingBody = await completeTask(speaker, task.id)
    expect(missingBody.status).toBe(400)
    const missingRequired = await completeTask(speaker, task.id, {})
    expect(missingRequired.status).toBe(400)
    const hiddenRequired = await completeTask(speaker, task.id, { format: 'workshop' })
    expect(hiddenRequired.status).toBe(400)

    const row = await env.DB.prepare('SELECT status, response FROM speaker_tasks WHERE id = ?')
      .bind(task.id)
      .first<{ status: string; response: string | null }>()
    expect(row?.status).toBe('pending')
    expect(row?.response).toBeNull()
  })

  it('persists validated answers, completes idempotently, and clears readiness', async () => {
    const { speaker, organizer, task } = await acceptAndAssign()
    const valid = await completeTask(speaker, task.id, { format: 'talk' })
    expect(valid.status).toBe(200)
    const body = (await valid.json()) as FormTaskBody
    expect(body.status).toBe('completed')
    expect(body.response).toEqual({ format: 'talk' })

    const row = await env.DB.prepare('SELECT response FROM speaker_tasks WHERE id = ?')
      .bind(task.id)
      .first<{ response: string | null }>()
    expect(JSON.parse(row?.response ?? 'null')).toEqual({ format: 'talk' })

    const repeat = await completeTask(speaker, task.id, { format: 'workshop' })
    expect(repeat.status).toBe(200)
    expect(((await repeat.json()) as FormTaskBody).response).toEqual({ format: 'talk' })
    const kept = await env.DB.prepare('SELECT response FROM speaker_tasks WHERE id = ?')
      .bind(task.id)
      .first<{ response: string | null }>()
    expect(JSON.parse(kept?.response ?? 'null')).toEqual({ format: 'talk' })

    const readiness = await app.request(
      '/api/admin/readiness?eventSlug=demo-conf-2026',
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    const readinessBody = (await readiness.json()) as { completedTasks: number }
    expect(readinessBody.completedTasks).toBeGreaterThanOrEqual(1)
  })

  it('denies cross-speaker completion as a safe 404', async () => {
    const { task } = await acceptAndAssign()
    const stranger = await submitterCookie(env.DB, {}, CO_SPEAKER_EMAIL)
    const denied = await completeTask(stranger, task.id, { format: 'talk' })
    expect(denied.status).toBe(404)
  })
})
