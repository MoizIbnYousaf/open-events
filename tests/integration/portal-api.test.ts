import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
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
  parseCookieToken,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

// Speaker portal API contract: GET /api/public/submissions returns only the
// signed-in speaker's own submissions for their own event, newest submission
// first, as a { submissions } envelope of list items. Anonymous requests get
// the standard nested error envelope with 401. No cross-owner rows may ever
// appear, and heavy detail payloads (answers) stay out of the list.
//
// The persisted status is pinned to 'pending' by migration 0002 and acceptance
// is its own record, so each row also carries `accepted` — the only way the
// portal can ever show an accepted proposal.

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    // 0006 creates agenda_sessions: acceptance places the accepted proposal on
    // the agenda in the same batch, so this suite runs the real schema.
    { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
    { name: '0007_create_speaker_task_tables.sql', queries: splitSqlStatements(migration0007Sql) },
    { name: '0011_add_form_tasks.sql', queries: splitSqlStatements(migration0011Sql) },
  ])
  await seedDemoConf(env.DB)
})

/** Clears the event dates through the real organizer configuration route. */
async function clearEventDates(): Promise<void> {
  const { token } = await loginOrganizer()
  if (token === null) throw new Error('organizer login set no cookie')
  const response = await app.request(
    '/api/admin/events/demo-conf-2026',
    {
      method: 'PATCH',
      headers: {
        cookie: cookieHeader(token),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ dates: null }),
    },
    bindings(),
  )
  if (response.status !== 200) throw new Error(`clearing dates failed with ${response.status}`)
}

async function acceptAsOrganizer(submissionId: string): Promise<void> {
  const { token } = await loginOrganizer()
  if (token === null) throw new Error('organizer login set no cookie')
  const response = await app.request(
    `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
    { method: 'POST', headers: { cookie: cookieHeader(token), origin: ALLOWED_ORIGIN } },
    bindings(),
  )
  if (response.status !== 200) throw new Error(`accept failed with ${response.status}`)
}

async function speakerCookie(email: string): Promise<string> {
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
  const message = await env.DB.prepare(
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
  if (redeem.status !== 303) throw new Error(`redeem failed with ${redeem.status}`)
  const token = parseCookieToken(redeem.headers.get('set-cookie'))
  if (token === null) throw new Error('redeem set no session cookie')
  return token
}

async function submitAs(cookie: string, title: string): Promise<string> {
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
        answers: SEEDED_TALK_ANSWERS,
        coSpeakers: [],
      }),
    },
    bindings(),
  )
  expect(response.status).toBe(200)
  const detail = (await response.json()) as { id: string }
  return detail.id
}

async function listOwn(cookie?: string) {
  return app.request(
    '/api/public/submissions',
    cookie === undefined ? undefined : { headers: { cookie: cookieHeader(cookie) } },
    bindings(),
  )
}

describe('speaker portal API', () => {
  it('rejects anonymous access with the standard 401 envelope', async () => {
    const response = await listOwn()
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBeTypeOf('string')
    expect(body.error.message).toBeTypeOf('string')
    expect(Object.keys(body)).toEqual(['error'])
  })

  it('returns only the owner submissions, newest first, as list items', async () => {
    const ada = await submitterCookie(env.DB)
    const first = await submitAs(ada, 'First accepted talk idea')
    const second = await submitAs(ada, 'Second better talk idea')

    const response = await listOwn(ada)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      submissions: ReadonlyArray<Record<string, unknown>>
    }
    expect(body.submissions).toHaveLength(2)
    expect(body.submissions.map((s) => s.id)).toEqual([second, first])
    for (const item of body.submissions) {
      expect(item.title).toBeTypeOf('string')
      expect(item.status).toBeTypeOf('string')
      expect(item.accepted).toBe(false)
      expect(item).not.toHaveProperty('answers')
    }
  })

  it('reports acceptance on the owning speaker own row only', async () => {
    const ada = await submitterCookie(env.DB)
    const acceptedId = await submitAs(ada, 'Accepted talk idea')
    const pendingId = await submitAs(ada, 'Still pending talk idea')
    await acceptAsOrganizer(acceptedId)

    const body = (await (await listOwn(ada)).json()) as {
      submissions: ReadonlyArray<{ id: string; status: string; accepted: boolean }>
    }
    const byId = new Map(body.submissions.map((item) => [item.id, item]))
    expect(byId.get(acceptedId)?.accepted).toBe(true)
    // Acceptance is its own record: the persisted status never changes.
    expect(byId.get(acceptedId)?.status).toBe('pending')
    expect(byId.get(pendingId)?.accepted).toBe(false)

    const grace = await speakerCookie('speaker.grace@example.test')
    const other = (await (await listOwn(grace)).json()) as { submissions: ReadonlyArray<unknown> }
    expect(other.submissions).toHaveLength(0)
  })

  // routing is the organizer's triage decision (manual_review flags and the
  // internal track/tag keys). It is rendered on the organizer list only, and
  // this is a public read, so the payload is an exact allowlist.
  it('sends an exact field allowlist that excludes the organizer routing outcome', async () => {
    const ada = await submitterCookie(env.DB)
    await submitAs(ada, 'A talk with a routed answer')

    const body = (await (await listOwn(ada)).json()) as {
      submissions: ReadonlyArray<Record<string, unknown>>
    }
    const item = body.submissions[0]
    if (item === undefined) throw new Error('expected one own submission')

    expect(item).not.toHaveProperty('routing')
    expect(Object.keys(item).sort()).toEqual(
      [
        'accepted',
        'coSpeakerCount',
        'createdAt',
        'decidedAt',
        'decision',
        'formId',
        'formSlug',
        'id',
        'inviteAvailable',
        'primarySpeaker',
        'status',
        'submittedAt',
        'title',
        'version',
      ].sort(),
    )
  })

  // The portal renders a `download` anchor from inviteAvailable. The invite
  // route answers 409 JSON without event dates, and the browser would save that
  // error body as the .ics — so the flag must follow the event configuration.
  it('withdraws calendar-invite availability when the event dates are cleared', async () => {
    const ada = await submitterCookie(env.DB)
    const acceptedId = await submitAs(ada, 'Accepted talk with an invite')
    await acceptAsOrganizer(acceptedId)

    const dated = (await (await listOwn(ada)).json()) as {
      submissions: ReadonlyArray<{ id: string; accepted: boolean; inviteAvailable: boolean }>
    }
    expect(dated.submissions[0]).toMatchObject({ accepted: true, inviteAvailable: true })

    await clearEventDates()

    const undated = (await (await listOwn(ada)).json()) as {
      submissions: ReadonlyArray<{ id: string; accepted: boolean; inviteAvailable: boolean }>
    }
    expect(undated.submissions[0]).toMatchObject({ accepted: true, inviteAvailable: false })

    const invite = await app.request(
      `/api/public/invite/${acceptedId}.ics`,
      { headers: { cookie: cookieHeader(ada) } },
      bindings(),
    )
    expect(invite.status).toBe(409)
  })

  it('never leaks another speaker submissions', async () => {
    const ada = await submitterCookie(env.DB)
    await submitAs(ada, 'Ada only talk')

    const grace = await speakerCookie('speaker.grace@example.test')
    const response = await listOwn(grace)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { submissions: ReadonlyArray<unknown> }
    expect(body.submissions).toHaveLength(0)
  })
})
