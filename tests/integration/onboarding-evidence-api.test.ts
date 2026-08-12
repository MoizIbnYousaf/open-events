import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0008Sql from '../../migrations/0008_create_uploaded_files_table.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
import migration0013Sql from '../../migrations/0013_add_contact_bio.sql?raw'
import migration0014Sql from '../../migrations/0014_widen_uploaded_file_kinds.sql?raw'
import app from '../../src/server'
import { DEMO_CONF_2026_VERSION_ID } from '../../src/db'
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

// O3 P3 end to end: bio and headshot tasks refuse the generic completion
// endpoint until the persisted evidence exists, and organizer readiness moves
// only when it does. confirm_participation remains labeled self-attestation.

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
    { name: '0007_create_speaker_task_tables.sql', queries: splitSqlStatements(migration0007Sql) },
    { name: '0008_create_uploaded_files_table.sql', queries: splitSqlStatements(migration0008Sql) },
    { name: '0011_add_form_tasks.sql', queries: splitSqlStatements(migration0011Sql) },
    { name: '0013_add_contact_bio.sql', queries: splitSqlStatements(migration0013Sql) },
    { name: '0014_widen_uploaded_file_kinds.sql', queries: splitSqlStatements(migration0014Sql) },
  ])
  await seedDemoConf(env.DB)
})

interface TaskBody {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly evidence: string
}

async function acceptedSpeaker(): Promise<{ speaker: string; organizer: string }> {
  const speaker = await submitterCookie(env.DB)
  const draftId = await savePublicDraft(speaker, { title: 'Evidence talk' })
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
        title: 'Evidence talk',
        answers: SEEDED_TALK_ANSWERS,
        coSpeakers: [],
      }),
    },
    bindings(),
  )
  expect(submit.status).toBe(200)
  const submissionId = ((await submit.json()) as { id: string }).id
  const { token } = await loginOrganizer()
  if (token === null) throw new Error('organizer login failed')
  const accept = await app.request(
    `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
    { method: 'POST', headers: { cookie: cookieHeader(token), origin: ALLOWED_ORIGIN } },
    bindings(),
  )
  expect(accept.status).toBe(200)
  return { speaker, organizer: token }
}

async function ownTasks(speaker: string): Promise<readonly TaskBody[]> {
  const list = await app.request(
    '/api/public/tasks',
    { headers: { cookie: cookieHeader(speaker) } },
    bindings(),
  )
  expect(list.status).toBe(200)
  return (await list.json()) as readonly TaskBody[]
}

async function complete(speaker: string, taskId: string): Promise<Response> {
  return app.request(
    `/api/public/tasks/${taskId}/complete`,
    { method: 'POST', headers: { cookie: cookieHeader(speaker), origin: ALLOWED_ORIGIN } },
    bindings(),
  )
}

async function readinessCompleted(organizer: string): Promise<number> {
  const readiness = await app.request(
    '/api/admin/readiness?eventSlug=demo-conf-2026',
    { headers: { cookie: cookieHeader(organizer) } },
    bindings(),
  )
  return ((await readiness.json()) as { completedTasks: number }).completedTasks
}

describe('evidence-checked completion over the API', () => {
  it('labels evidence kinds and gates bio/headshot on persisted proof', async () => {
    const { speaker, organizer } = await acceptedSpeaker()
    const tasks = await ownTasks(speaker)
    const byKind = new Map(tasks.map((task) => [task.kind, task]))
    expect(byKind.get('confirm_participation')?.evidence).toBe('self_attestation')
    expect(byKind.get('submit_bio')?.evidence).toBe('bio')
    expect(byKind.get('submit_headshot')?.evidence).toBe('headshot')

    const bioTask = byKind.get('submit_bio')
    const headshotTask = byKind.get('submit_headshot')
    if (bioTask === undefined || headshotTask === undefined) throw new Error('missing tasks')

    expect((await complete(speaker, bioTask.id)).status).toBe(400)
    expect((await complete(speaker, headshotTask.id)).status).toBe(400)
    expect(await readinessCompleted(organizer)).toBe(0)

    const profile = await app.request(
      '/api/public/profile',
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Ada', bio: 'A real persisted bio.' }),
      },
      bindings(),
    )
    expect(profile.status).toBe(200)
    expect((await complete(speaker, bioTask.id)).status).toBe(200)

    const upload = await app.request(
      '/api/public/profile/headshot',
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'image/png',
        },
        body: new Uint8Array(32).fill(1).buffer,
      },
      bindings(),
    )
    expect(upload.status).toBe(200)
    expect((await complete(speaker, headshotTask.id)).status).toBe(200)

    const confirm = byKind.get('confirm_participation')
    if (confirm === undefined) throw new Error('missing confirm task')
    expect((await complete(speaker, confirm.id)).status).toBe(200)
    expect(await readinessCompleted(organizer)).toBe(3)
  })
})

describe('completion body handling (O4 regression)', () => {
  it('accepts a JSON content type with an empty body and rejects malformed JSON', async () => {
    const { speaker } = await acceptedSpeaker()
    const tasks = await ownTasks(speaker)
    const confirm = tasks.find((task) => task.kind === 'confirm_participation')
    if (confirm === undefined) throw new Error('missing confirm task')

    // The portal client always declares JSON; a bare completion has no body.
    const emptyBody = await app.request(
      `/api/public/tasks/${confirm.id}/complete`,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
      },
      bindings(),
    )
    expect(emptyBody.status).toBe(200)

    const malformed = await app.request(
      `/api/public/tasks/${confirm.id}/complete`,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: '{not json',
      },
      bindings(),
    )
    expect(malformed.status).toBe(400)
  })
})
