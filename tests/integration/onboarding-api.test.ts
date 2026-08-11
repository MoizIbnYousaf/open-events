import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
import app from '../../src/server'
import { createAcceptUnitOfWork } from '../../src/db'
import { DEMO_CONF_2026_ID } from '../../src/db'
import type { SpeakerTask } from '../../src/domain'
import { SPEAKER_TASK_KINDS } from '../../src/domain'
import { applyMigrations, seedDemoConf, splitSqlStatements } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'

// Onboarding core API contract: organizer acceptance turns a pending
// submission into an onboarding checklist (one task per kind per contributor),
// speakers see and complete only their own tasks, and the organizer readiness
// read aggregates the checklist. Every route is exercised through the real
// application with real sessions and the real CSRF gate.

const NOW = '2026-08-10T09:00:00.000Z'
const SPEAKER_EMAIL = 'speaker-a@example.test'
const CO_SPEAKER_EMAIL = 'speaker-b@example.test'
const READINESS_PATH = '/api/admin/readiness?eventSlug=demo-conf-2026'

interface TaskBody {
  readonly id: string
  readonly submissionId: string
  readonly contactId: string
  readonly kind: string
  readonly status: string
  readonly completedAt: string | null
}

interface AcceptBody {
  readonly submissionId: string
  readonly alreadyAccepted: boolean
  readonly acceptedAt: string
  readonly tasks: readonly TaskBody[]
}

interface ReadinessBody {
  readonly eventId: string
  readonly acceptedSubmissions: number
  readonly totalTasks: number
  readonly completedTasks: number
  readonly percentComplete: number
  readonly submissions: ReadonlyArray<{
    readonly submissionId: string
    readonly title: string
    readonly totalTasks: number
    readonly completedTasks: number
    readonly percentComplete: number
    readonly ready: boolean
  }>
}

/** Submits a proposal with one co-speaker through the real public routes. */
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
        formVersionId: 'f0000000-0000-4000-8000-000000000002',
        title: 'Workshop proposal',
        answers: { format: 'workshop', workshop_details: 'Hands-on' },
        coSpeakers: [{ name: 'Speaker B', email: CO_SPEAKER_EMAIL }],
      }),
    },
    bindings(),
  )
  if (response.status !== 200) throw new Error(`submit failed with ${response.status}`)
  const body = (await response.json()) as { id: string }
  return body.id
}

async function acceptSubmission(
  organizerToken: string,
  submissionId: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(
    `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(organizerToken),
        origin: ALLOWED_ORIGIN,
        ...headers,
      },
    },
    bindings(),
  )
}

async function contactIdFor(email: string): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM contacts WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (row === null) throw new Error(`no contact for ${email}`)
  return row.id
}

async function countTasks(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM speaker_tasks').first<{ n: number }>()
  return row?.n ?? 0
}

interface AgendaSessionRow {
  readonly event_id: string
  readonly submission_id: string
  readonly track_id: string | null
  readonly room_id: string | null
  readonly day: string
  readonly start: string
  readonly end: string
  readonly position: number | null
  readonly status: string
  readonly assignment: string
}

async function countAgendaSessions(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM agenda_sessions').first<{
    n: number
  }>()
  return row?.n ?? 0
}

let organizerToken: string
let speakerCookie: string
let submissionId: string

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    // 0006 creates agenda_sessions: acceptance places the accepted proposal on
    // the agenda in the same atomic batch as the checklist.
    { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
    { name: '0007_create_speaker_task_tables.sql', queries: splitSqlStatements(migration0007Sql) },
    { name: '0011_add_form_tasks.sql', queries: splitSqlStatements(migration0011Sql) },
  ])
  await seedDemoConf(env.DB)
  const login = await loginOrganizer()
  if (login.token === null) throw new Error('organizer login set no cookie')
  organizerToken = login.token
  speakerCookie = await submitterCookie(env.DB)
  submissionId = await submitProposal(speakerCookie)
})

describe('POST /api/admin/events/demo-conf-2026/submissions/:id/accept', () => {
  it('requires an organizer session and a same-origin request', async () => {
    const anonymous = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
      { method: 'POST', headers: { origin: ALLOWED_ORIGIN } },
      bindings(),
    )
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' },
    })

    const submitter = await acceptSubmission(speakerCookie, submissionId)
    expect(submitter.status).toBe(403)
    expect(await submitter.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } })

    const crossOrigin = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
      {
        method: 'POST',
        headers: { cookie: cookieHeader(organizerToken), origin: 'http://evil.test' },
      },
      bindings(),
    )
    expect(crossOrigin.status).toBe(403)
    expect(await countTasks()).toBe(0)
  })

  it('creates one task per checklist kind for every contributor', async () => {
    const response = await acceptSubmission(organizerToken, submissionId)
    expect(response.status).toBe(200)
    const body = (await response.json()) as AcceptBody

    expect(body.submissionId).toBe(submissionId)
    expect(body.alreadyAccepted).toBe(false)
    expect(body.tasks).toHaveLength(SPEAKER_TASK_KINDS.length * 2)
    expect(new Set(body.tasks.map((task) => task.contactId))).toEqual(
      new Set([await contactIdFor(SPEAKER_EMAIL), await contactIdFor(CO_SPEAKER_EMAIL)]),
    )
    expect(body.tasks.every((task) => task.status === 'pending')).toBe(true)
    expect(await countTasks()).toBe(SPEAKER_TASK_KINDS.length * 2)
  })

  // Acceptance is what turns a proposal into something the organizer can place
  // on the agenda; without this row the schedule stays permanently empty.
  it('places the accepted submission on the agenda as an unassigned session', async () => {
    expect(await countAgendaSessions()).toBe(0)

    const response = await acceptSubmission(organizerToken, submissionId)
    expect(response.status).toBe(200)

    const session = await env.DB.prepare('SELECT * FROM agenda_sessions WHERE submission_id = ?')
      .bind(submissionId)
      .first<AgendaSessionRow>()
    expect(session).not.toBeNull()
    expect(session?.event_id).toBe(DEMO_CONF_2026_ID)
    expect(session?.status).toBe('draft')
    expect(session?.assignment).toBe('unassigned')
    expect(session?.room_id).toBeNull()
    expect(session?.track_id).toBeNull()
    expect(session?.position).toBeNull()
    // The seeded event starts 2026-05-13T08:00:00.000Z.
    expect(session?.day).toBe('2026-05-13')
    expect(session?.start).toBe('2026-05-13T08:00:00.000Z')
    expect(session?.end).toBe('2026-05-13T09:00:00.000Z')

    const speakers = await env.DB.prepare(
      'SELECT contact_id FROM agenda_session_speakers WHERE submission_id = ?',
    )
      .bind(submissionId)
      .all<{ contact_id: string }>()
    expect(new Set(speakers.results.map((row) => row.contact_id))).toEqual(
      new Set([await contactIdFor(SPEAKER_EMAIL), await contactIdFor(CO_SPEAKER_EMAIL)]),
    )
  })

  it('never places a second agenda session on a repeated accept', async () => {
    await acceptSubmission(organizerToken, submissionId)
    await acceptSubmission(organizerToken, submissionId)

    expect(await countAgendaSessions()).toBe(1)
    const speakers = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM agenda_session_speakers WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ n: number }>()
    expect(speakers?.n).toBe(2)
  })

  it('is idempotent under a repeated accept', async () => {
    const first = (await (
      await acceptSubmission(organizerToken, submissionId)
    ).json()) as AcceptBody
    const second = (await (
      await acceptSubmission(organizerToken, submissionId)
    ).json()) as AcceptBody

    expect(second.alreadyAccepted).toBe(true)
    expect(second.acceptedAt).toBe(first.acceptedAt)
    expect(second.tasks.map((task) => task.id).sort()).toEqual(
      first.tasks.map((task) => task.id).sort(),
    )
    expect(await countTasks()).toBe(SPEAKER_TASK_KINDS.length * 2)
  })

  it('returns a uniform 404 for an unknown submission', async () => {
    const response = await acceptSubmission(organizerToken, 'submission-missing')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('rolls the whole acceptance back when a task violates an integrity rule', async () => {
    const invalidTask: SpeakerTask = {
      id: 'task-invalid',
      eventId: DEMO_CONF_2026_ID,
      submissionId,
      contactId: 'contact-does-not-exist',
      kind: 'submit_bio',
      status: 'pending',
      position: 0,
      formId: null,
      formVersionId: null,
      response: null,
      createdAt: NOW,
      completedAt: null,
    }
    const unitOfWork = createAcceptUnitOfWork(env.DB)

    await expect(
      unitOfWork.execute({
        eventId: DEMO_CONF_2026_ID,
        submissionId,
        acceptedAt: NOW,
        tasks: [invalidTask],
        session: {
          day: '2026-05-13',
          start: '2026-05-13T08:00:00.000Z',
          end: '2026-05-13T09:00:00.000Z',
          speakerContactIds: [await contactIdFor(SPEAKER_EMAIL)],
        },
      }),
    ).rejects.toBeInstanceOf(Error)

    const acceptance = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM submission_acceptances',
    ).first<{ n: number }>()
    expect(acceptance?.n).toBe(0)
    expect(await countTasks()).toBe(0)
    expect(await countAgendaSessions()).toBe(0)
  })
})

describe('speaker task list and completion', () => {
  beforeEach(async () => {
    const response = await acceptSubmission(organizerToken, submissionId)
    expect(response.status).toBe(200)
  })

  it('scopes GET /api/public/tasks to the calling speaker', async () => {
    const anonymous = await app.request('/api/public/tasks', undefined, bindings())
    expect(anonymous.status).toBe(401)

    const organizer = await app.request(
      '/api/public/tasks',
      { headers: { cookie: cookieHeader(organizerToken) } },
      bindings(),
    )
    expect(organizer.status).toBe(403)

    const response = await app.request(
      '/api/public/tasks',
      { headers: { cookie: cookieHeader(speakerCookie) } },
      bindings(),
    )
    expect(response.status).toBe(200)
    const tasks = (await response.json()) as readonly TaskBody[]
    expect(tasks).toHaveLength(SPEAKER_TASK_KINDS.length)
    const ownContactId = await contactIdFor(SPEAKER_EMAIL)
    expect(tasks.every((task) => task.contactId === ownContactId)).toBe(true)
  })

  it('completes an own task idempotently and denies another speaker task', async () => {
    const listed = (await (
      await app.request(
        '/api/public/tasks',
        { headers: { cookie: cookieHeader(speakerCookie) } },
        bindings(),
      )
    ).json()) as readonly TaskBody[]
    const target = listed[0]
    if (target === undefined) throw new Error('expected a task')

    const complete = async (id: string, headers: Record<string, string> = {}): Promise<Response> =>
      app.request(
        `/api/public/tasks/${id}/complete`,
        {
          method: 'POST',
          headers: { cookie: cookieHeader(speakerCookie), origin: ALLOWED_ORIGIN, ...headers },
        },
        bindings(),
      )

    const first = await complete(target.id)
    expect(first.status).toBe(200)
    const completed = (await first.json()) as TaskBody
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).not.toBeNull()

    const again = (await (await complete(target.id)).json()) as TaskBody
    expect(again.completedAt).toBe(completed.completedAt)

    const coSpeakerTask = await env.DB.prepare(
      'SELECT id FROM speaker_tasks WHERE contact_id = ? LIMIT 1',
    )
      .bind(await contactIdFor(CO_SPEAKER_EMAIL))
      .first<{ id: string }>()
    if (coSpeakerTask === null) throw new Error('expected a co-speaker task')
    const denied = await complete(coSpeakerTask.id)
    expect(denied.status).toBe(404)
    expect(await denied.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })

    const crossOrigin = await complete(target.id, { origin: 'http://evil.test' })
    expect(crossOrigin.status).toBe(403)
  })
})

describe('GET /api/admin/readiness', () => {
  it('requires an organizer session', async () => {
    const anonymous = await app.request(READINESS_PATH, undefined, bindings())
    expect(anonymous.status).toBe(401)

    const submitter = await app.request(
      READINESS_PATH,
      { headers: { cookie: cookieHeader(speakerCookie) } },
      bindings(),
    )
    expect(submitter.status).toBe(403)
  })

  it('fails closed on a missing event and on an unknown event', async () => {
    const missing = await app.request(
      '/api/admin/readiness',
      { headers: { cookie: cookieHeader(organizerToken) } },
      bindings(),
    )
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })

    const unknown = await app.request(
      '/api/admin/readiness?eventSlug=no-such-event',
      { headers: { cookie: cookieHeader(organizerToken) } },
      bindings(),
    )
    expect(unknown.status).toBe(404)
  })

  it('aggregates checklist completion for the event', async () => {
    const empty = (await (
      await app.request(
        READINESS_PATH,
        { headers: { cookie: cookieHeader(organizerToken) } },
        bindings(),
      )
    ).json()) as ReadinessBody
    expect(empty).toEqual({
      eventId: DEMO_CONF_2026_ID,
      acceptedSubmissions: 0,
      totalTasks: 0,
      completedTasks: 0,
      percentComplete: 100,
      submissions: [],
    })

    await acceptSubmission(organizerToken, submissionId)
    const listed = (await (
      await app.request(
        '/api/public/tasks',
        { headers: { cookie: cookieHeader(speakerCookie) } },
        bindings(),
      )
    ).json()) as readonly TaskBody[]
    const target = listed[0]
    if (target === undefined) throw new Error('expected a task')
    await app.request(
      `/api/public/tasks/${target.id}/complete`,
      {
        method: 'POST',
        headers: { cookie: cookieHeader(speakerCookie), origin: ALLOWED_ORIGIN },
      },
      bindings(),
    )

    const readiness = (await (
      await app.request(
        READINESS_PATH,
        { headers: { cookie: cookieHeader(organizerToken) } },
        bindings(),
      )
    ).json()) as ReadinessBody
    expect(readiness.acceptedSubmissions).toBe(1)
    expect(readiness.totalTasks).toBe(SPEAKER_TASK_KINDS.length * 2)
    expect(readiness.completedTasks).toBe(1)
    expect(readiness.percentComplete).toBe(17)
    expect(readiness.submissions).toEqual([
      {
        submissionId,
        title: 'Workshop proposal',
        totalTasks: SPEAKER_TASK_KINDS.length * 2,
        completedTasks: 1,
        percentComplete: 17,
        ready: false,
      },
    ])
  })
})
