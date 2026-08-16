import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { applyMigrations, seedDemoConf, SEEDED_TALK_ANSWERS } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

/**
 * The organizer's view of the people on their programme.
 *
 * Every speaker-side surface existed first — the portal, onboarding tasks, the
 * profile editor, headshot and document upload — and the organizer had no
 * screen listing a single speaker. So the work speakers did arrived nowhere.
 */
describe('the organizer speaker roster', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
  })

  async function organizerCookie(): Promise<string> {
    return (await loginOrganizer()).token ?? ''
  }

  async function submitAs(email: string, title: string, coSpeakers: unknown[] = []): Promise<void> {
    const speaker = await submitterCookie(env.DB, {}, email)
    const draftId = await savePublicDraft(speaker, { title, answers: SEEDED_TALK_ANSWERS })
    const response = await app.request(
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
          title,
          answers: SEEDED_TALK_ANSWERS,
          coSpeakers,
        }),
      },
      bindings(),
    )
    expect(response.status).toBe(200)
  }

  async function roster(cookie: string): Promise<readonly Record<string, unknown>[]> {
    const response = await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(response.status).toBe(200)
    return (await response.json()) as readonly Record<string, unknown>[]
  }

  it('lists everyone who is on a proposal, co-speakers included', async () => {
    const organizer = await organizerCookie()
    await submitAs('ada@example.test', 'Taming CI', [
      { name: 'Marcus Okafor', email: 'marcus@example.test' },
    ])

    const people = await roster(organizer)

    // Being on a proposal is what makes someone a speaker of the event — the
    // same rule the submissions list and the agenda already use, so the roster
    // cannot disagree with them about who exists.
    expect(people.map((person) => person.email).sort()).toEqual([
      'ada@example.test',
      'marcus@example.test',
    ])
  })

  it('carries the numbers an organizer actually chases', async () => {
    const organizer = await organizerCookie()
    await submitAs('ada@example.test', 'Taming CI')

    const ada = (await roster(organizer)).find((person) => person.email === 'ada@example.test')

    expect(ada?.proposalCount).toBe(1)
    // Nobody has written a bio or uploaded a headshot yet, so the profile is
    // incomplete — which is the whole reason this column exists.
    expect(ada?.hasHeadshot).toBe(false)
    expect(ada?.profileComplete).toBe(false)
    expect(ada?.outstandingTaskCount).toBe(0)
  })

  it('reports a speaker who has written a bio as still incomplete without a headshot', async () => {
    const organizer = await organizerCookie()
    await submitAs('ada@example.test', 'Taming CI')
    await env.DB.prepare('UPDATE contacts SET bio = ? WHERE email = ?')
      .bind('Platform engineer.', 'ada@example.test')
      .run()

    const ada = (await roster(organizer)).find((person) => person.email === 'ada@example.test')

    // Chasing one half without the other is how a speaker gets asked twice for
    // something they already sent.
    expect(ada?.bio).toBe('Platform engineer.')
    expect(ada?.profileComplete).toBe(false)
  })

  it('issues a canonical portal-purpose link when the organizer invites a co-speaker', async () => {
    const organizer = await organizerCookie()
    await submitAs('ada@example.test', 'Taming CI', [
      { name: 'Marcus Okafor', email: 'marcus@example.test' },
    ])
    const marcus = (await roster(organizer)).find(
      (person) => person.email === 'marcus@example.test',
    )
    expect(typeof marcus?.contactId).toBe('string')
    await env.DB.prepare(
      "UPDATE cfp_forms SET status = 'draft', published_version_id = NULL WHERE event_id = ?",
    )
      .bind(DEMO_CONF_2026_ID)
      .run()
    await env.DB.prepare(
      "UPDATE mail_budget_events SET created_at = '2020-01-01T00:00:00.000Z'",
    ).run()

    const invited = await app.request(
      `/api/admin/events/demo-conf-2026/speakers/${String(marcus?.contactId)}/invite`,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          host: 'attacker.example',
          'x-forwarded-host': 'attacker.example',
        },
      },
      bindings(),
    )

    expect(invited.status).toBe(200)
    const payload = (await invited.json()) as {
      sent: boolean
      to: string
      invitePath: string | null
    }
    expect(payload).toMatchObject({ sent: true, to: 'marcus@example.test' })
    expect(payload.invitePath).toMatch(
      /^https:\/\/www\.openevents\.engineer\/api\/public\/session\?token=/,
    )

    const stored = await env.DB.prepare(
      `SELECT purpose, form_id FROM submitter_tokens
       WHERE contact_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(marcus?.contactId)
      .first<{ purpose: string | null; form_id: string | null }>()
    expect(stored?.purpose).toBe('portal')
    expect(stored?.form_id).toBeNull()

    const redeemed = await app.request(payload.invitePath ?? '', undefined, bindings())
    expect(redeemed.status).toBe(303)
    expect(redeemed.headers.get('location')).toBe('/portal')
  })

  it('is organizer-only', async () => {
    const response = await app.request(
      '/api/admin/events/demo-conf-2026/speakers',
      undefined,
      bindings(),
    )
    expect(response.status).toBe(401)
  })
})

/**
 * The track the submitter chose has to reach the programme.
 *
 * An accepted proposal became an agenda session with no track at all, so the
 * public schedule published a blank track column and the track filter built on
 * top of it had nothing to filter. The submitter had answered the question;
 * acceptance simply dropped the answer.
 */
describe('accepting a proposal keeps its track', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
  })

  it('carries the answered track onto the agenda session', async () => {
    const organizer = (await loginOrganizer()).token ?? ''
    const speaker = await submitterCookie(env.DB, {}, 'tracked@example.test')
    const draftId = await savePublicDraft(speaker, {
      title: 'Tracked talk',
      answers: SEEDED_TALK_ANSWERS,
    })
    const submitted = await app.request(
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
          title: 'Tracked talk',
          answers: SEEDED_TALK_ANSWERS,
          coSpeakers: [],
        }),
      },
      bindings(),
    )
    const submissionId = ((await submitted.json()) as { id: string }).id

    const accepted = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/accept`,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
      },
      bindings(),
    )
    expect(accepted.status).toBe(200)

    const session = await env.DB.prepare(
      'SELECT track_id FROM agenda_sessions WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ track_id: string | null }>()

    // The seeded proposal answers 'Platform & Infra', which the event's own
    // vocabulary knows — so the session carries that track's id rather than
    // null, and the programme can group and filter by it.
    expect(session?.track_id).not.toBeNull()
    const track = await env.DB.prepare('SELECT label FROM taxonomy_items WHERE id = ?')
      .bind(session?.track_id)
      .first<{ label: string }>()
    expect(track?.label).toBe('Platform & Infra')
  })
})
