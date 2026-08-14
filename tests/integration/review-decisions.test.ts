import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { SEEDED_TALK_ANSWERS, applyMigrations, seedDemoConf } from './m2b-helpers'
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

/**
 * The two halves of deciding a programme that the product could not express.
 *
 * A reviewer could only be given work if they happened to already exist as a
 * contact, which in practice meant they had signed in at least once — so an
 * organizer could not invite the committee they wanted, only the committee that
 * had already turned up. And a submission could only ever be accepted: there was
 * no reject, so every proposal an organizer declined stayed indistinguishable
 * from one nobody had looked at, on the organizer's board and in the speaker's
 * portal alike.
 */
beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

const COMMITTEE_PATH = '/api/admin/events/demo-conf-2026/evaluations/committee'
const COLD_REVIEWER = 'cold.reviewer@example.test'
const OTHER_EVENT_ID = 'e0000000-0000-4000-8000-0000000009ff'
const OTHER_EVENT_SLUG = 'other-conf-2026'

interface CommitteeMemberBody {
  readonly contactId: string
  readonly email: string
  readonly name: string
  readonly addedAt: string
  readonly created: boolean
}

interface DecisionHistoryBody {
  readonly sequence: number
  readonly decision: 'accepted' | 'rejected'
  readonly decidedBy: string
  readonly decidedAt: string
}

interface DecisionBody {
  readonly submissionId: string
  readonly eventId: string
  readonly decision: 'accepted' | 'rejected' | null
  readonly decidedBy: string | null
  readonly decidedAt: string | null
  readonly changed: boolean
  readonly history: readonly DecisionHistoryBody[]
}

interface OwnSubmissionBody {
  readonly id: string
  readonly accepted: boolean
  readonly inviteAvailable: boolean
  readonly decision: 'accepted' | 'rejected' | null
  readonly decidedAt: string | null
}

/** loginOrganizer returns a response envelope; the session value is `token`. */
async function organizerCookie(): Promise<string> {
  const session = await loginOrganizer()
  expect(session.token).not.toBeNull()
  return session.token ?? ''
}

async function inviteReviewer(
  cookie: string,
  body: Record<string, unknown>,
  path = COMMITTEE_PATH,
  origin = ALLOWED_ORIGIN,
): Promise<Response> {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { cookie: cookieHeader(cookie), origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    bindings(),
  )
}

function decisionPath(submissionId: string, slug = 'demo-conf-2026'): string {
  return `/api/admin/events/${slug}/submissions/${submissionId}/decision`
}

async function decide(
  cookie: string,
  submissionId: string,
  body: Record<string, unknown>,
  slug = 'demo-conf-2026',
  origin = ALLOWED_ORIGIN,
): Promise<Response> {
  return app.request(
    decisionPath(submissionId, slug),
    {
      method: 'POST',
      headers: { cookie: cookieHeader(cookie), origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    bindings(),
  )
}

/** A speaker with one submitted proposal; returns their cookie and its id. */
async function speakerWithSubmission(): Promise<{ cookie: string; submissionId: string }> {
  const cookie = await submitterCookie(env.DB)
  const draftId = await savePublicDraft(cookie, {
    title: 'Taming 40-Minute CI',
    answers: SEEDED_TALK_ANSWERS,
  })
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
        title: 'Taming 40-Minute CI',
        answers: SEEDED_TALK_ANSWERS,
        coSpeakers: [],
      }),
    },
    bindings(),
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as { id: string }
  return { cookie, submissionId: body.id }
}

/** The speaker's own portal row for one submission. */
async function portalRow(cookie: string, submissionId: string): Promise<OwnSubmissionBody> {
  const response = await app.request(
    '/api/public/submissions',
    { headers: { cookie: cookieHeader(cookie) } },
    bindings(),
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as { submissions: readonly OwnSubmissionBody[] }
  const row = body.submissions.find((candidate) => candidate.id === submissionId)
  if (row === undefined) throw new Error(`portal did not list submission '${submissionId}'`)
  return row
}

/** Signs a reviewer in through the real magic-link path, keeping the redirect. */
async function reviewerSignIn(email: string): Promise<{ cookie: string; location: string | null }> {
  const start = await app.request(
    '/api/public/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, eventSlug: 'demo-conf-2026', formSlug: 'cfp' }),
    },
    bindings(),
  )
  expect(start.status).toBe(202)
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
  expect(redeem.status).toBe(303)
  const cookie = parseCookieToken(redeem.headers.get('set-cookie'))
  if (cookie === null) throw new Error('redeem set no session cookie')
  return { cookie, location: redeem.headers.get('location') }
}

/** A second event, so 'wrong event' is a real place and not a missing one. */
async function seedOtherEvent(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
     VALUES (?, ?, 'Other Conf 2026', 'UTC', 'draft', NULL, NULL)`,
  )
    .bind(OTHER_EVENT_ID, OTHER_EVENT_SLUG)
    .run()
}

/**
 * The stored identity, read straight from the table rather than from a response
 * body. A refusal to overwrite has to be proven where the row actually lives:
 * an endpoint can echo back the name it was handed while having written a
 * different one underneath.
 */
async function storedContact(email: string): Promise<{ name: string; bio: string | null } | null> {
  return env.DB.prepare('SELECT name, bio FROM contacts WHERE email = ?')
    .bind(email)
    .first<{ name: string; bio: string | null }>()
}

async function committeeRowCount(contactId: string, eventId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM evaluation_committee_members WHERE contact_id = ? AND event_id = ?',
  )
    .bind(contactId, eventId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

describe('an organizer provisions a reviewer who has never signed in', () => {
  it('creates the contact and seats them on this event committee', async () => {
    const organizer = await organizerCookie()
    const response = await inviteReviewer(organizer, {
      email: COLD_REVIEWER,
      name: 'Cold Reviewer',
    })
    expect(response.status).toBe(200)
    const member = (await response.json()) as CommitteeMemberBody
    expect(member.email).toBe(COLD_REVIEWER)
    expect(member.name).toBe('Cold Reviewer')
    expect(member.created).toBe(true)
    expect(member.addedAt).toHaveLength(24)

    // The identity is a real contact row, keyed by email exactly as the sign-in
    // path keys it — otherwise the invite and the sign-in would be two people.
    const contact = await env.DB.prepare('SELECT id FROM contacts WHERE email = ?')
      .bind(COLD_REVIEWER)
      .first<{ id: string }>()
    expect(contact?.id).toBe(member.contactId)
    expect(await committeeRowCount(member.contactId, DEMO_CONF_2026_ID)).toBe(1)
  })

  it('is idempotent: inviting the same email twice seats them once', async () => {
    const organizer = await organizerCookie()
    const first = (await (
      await inviteReviewer(organizer, { email: COLD_REVIEWER, name: 'Cold Reviewer' })
    ).json()) as CommitteeMemberBody
    const repeat = await inviteReviewer(organizer, { email: COLD_REVIEWER, name: 'Renamed' })
    expect(repeat.status).toBe(200)
    const second = (await repeat.json()) as CommitteeMemberBody
    expect(second.contactId).toBe(first.contactId)
    expect(second.created).toBe(false)
    // The seat keeps the instant it was first taken: a repeat is not a new seat.
    expect(second.addedAt).toBe(first.addedAt)
    expect(await committeeRowCount(first.contactId, DEMO_CONF_2026_ID)).toBe(1)

    // Reuse, never mutate. The repeat deliberately passes a DIFFERENT name, and
    // it must be ignored: contacts are globally unique by email, so an upsert
    // that wrote the name through would let any organizer rename any person in
    // the system — including a speaker on somebody else's event — just by
    // inviting their address. Asserted in the response AND in the row, because
    // the two can disagree.
    expect(second.name).toBe('Cold Reviewer')
    expect(await storedContact(COLD_REVIEWER)).toMatchObject({ name: 'Cold Reviewer' })
  })

  /**
   * The same rule for a contact that already existed before any invite — the
   * case with real consequences, since that person may be a speaker with a name
   * and bio they wrote themselves. Inviting them onto a committee must seat
   * them and change nothing else about who they are.
   */
  it('reuses an existing contact without touching their name or bio', async () => {
    await env.DB.prepare(
      `INSERT INTO contacts (id, email, name, bio, created_at)
       VALUES ('contact-existing', ?, 'Ada Lovelace', 'Writes about analytical engines.', ?)`,
    )
      .bind(COLD_REVIEWER, '2026-01-01T00:00:00.000Z')
      .run()

    const organizer = await organizerCookie()
    const response = await inviteReviewer(organizer, {
      email: COLD_REVIEWER,
      name: 'Whatever The Organizer Typed',
    })

    expect(response.status).toBe(200)
    const member = (await response.json()) as CommitteeMemberBody
    // Their existing identity is reused, not duplicated and not rewritten.
    expect(member.contactId).toBe('contact-existing')
    expect(member.name).toBe('Ada Lovelace')
    expect(await storedContact(COLD_REVIEWER)).toEqual({
      name: 'Ada Lovelace',
      bio: 'Writes about analytical engines.',
    })
    expect(await committeeRowCount('contact-existing', DEMO_CONF_2026_ID)).toBe(1)
  })

  it('grants nothing beyond the event it was granted on', async () => {
    await seedOtherEvent()
    const organizer = await organizerCookie()
    const member = (await (
      await inviteReviewer(organizer, { email: COLD_REVIEWER, name: 'Cold Reviewer' })
    ).json()) as CommitteeMemberBody
    expect(await committeeRowCount(member.contactId, DEMO_CONF_2026_ID)).toBe(1)
    expect(await committeeRowCount(member.contactId, OTHER_EVENT_ID)).toBe(0)
  })

  it('is organizer-only and same-origin only', async () => {
    const speaker = await submitterCookie(env.DB)
    expect((await inviteReviewer(speaker, { email: COLD_REVIEWER })).status).toBe(403)
    const anonymous = await app.request(
      COMMITTEE_PATH,
      {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ email: COLD_REVIEWER }),
      },
      bindings(),
    )
    expect(anonymous.status).toBe(401)
    const organizer = await organizerCookie()
    expect(
      (
        await inviteReviewer(
          organizer,
          { email: COLD_REVIEWER },
          COMMITTEE_PATH,
          'https://evil.test',
        )
      ).status,
    ).toBe(403)
  })

  it('refuses an unknown event and an unusable email', async () => {
    const organizer = await organizerCookie()
    expect(
      (
        await inviteReviewer(
          organizer,
          { email: COLD_REVIEWER },
          '/api/admin/events/no-such-conf/evaluations/committee',
        )
      ).status,
    ).toBe(404)
    expect((await inviteReviewer(organizer, { email: 'not-an-email' })).status).toBe(400)
  })
})

describe('a cold-invited reviewer signs in and finds their queue', () => {
  it('reaches the review surface through the ordinary magic link', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    expect(
      (await inviteReviewer(organizer, { email: COLD_REVIEWER, name: 'Cold Reviewer' })).status,
    ).toBe(200)

    // Assigning by email must work for the same never-seen reviewer: the
    // provisioning gap was the same gap on both routes.
    const assigned = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/assignments`,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ evaluatorEmail: COLD_REVIEWER }),
      },
      bindings(),
    )
    expect(assigned.status).toBe(200)

    const { cookie, location } = await reviewerSignIn(COLD_REVIEWER)
    expect(location).toBe('/evaluations')
    const queue = await app.request(
      '/api/public/evaluations',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(queue.status).toBe(200)
    const rows = (await queue.json()) as readonly { submissionId: string }[]
    expect(rows.map((row) => row.submissionId)).toEqual([submissionId])
  })

  it('reports an empty queue rather than a refusal before any assignment', async () => {
    const organizer = await organizerCookie()
    expect((await inviteReviewer(organizer, { email: COLD_REVIEWER })).status).toBe(200)
    const { cookie } = await reviewerSignIn(COLD_REVIEWER)
    const queue = await app.request(
      '/api/public/evaluations',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(queue.status).toBe(200)
    expect(await queue.json()).toEqual([])
  })
})

describe('an organizer records an accept or a reject', () => {
  it('records an acceptance with the actor and the instant', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    const response = await decide(organizer, submissionId, { decision: 'accepted' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as DecisionBody
    expect(body.decision).toBe('accepted')
    expect(body.decidedBy).toBe('organizer')
    expect(body.decidedAt).toHaveLength(24)
    expect(body.changed).toBe(true)
    expect(await portalRow(cookie, submissionId)).toMatchObject({
      decision: 'accepted',
      accepted: true,
    })
  })

  it('records a rejection the speaker portal can read', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    expect((await decide(organizer, submissionId, { decision: 'rejected' })).status).toBe(200)
    const row = await portalRow(cookie, submissionId)
    expect(row.decision).toBe('rejected')
    expect(row.accepted).toBe(false)
    expect(row.inviteAvailable).toBe(false)
    expect(row.decidedAt).toHaveLength(24)
  })

  it('changes accept to reject and back, persisting each verdict', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()

    expect((await decide(organizer, submissionId, { decision: 'accepted' })).status).toBe(200)
    expect((await portalRow(cookie, submissionId)).decision).toBe('accepted')

    const rejected = (await (
      await decide(organizer, submissionId, { decision: 'rejected' })
    ).json()) as DecisionBody
    expect(rejected.decision).toBe('rejected')
    expect(rejected.changed).toBe(true)
    // An accepted proposal that is later rejected must not keep reading as
    // accepted anywhere the speaker can see it.
    expect(await portalRow(cookie, submissionId)).toMatchObject({
      decision: 'rejected',
      accepted: false,
    })

    const reAccepted = (await (
      await decide(organizer, submissionId, { decision: 'accepted' })
    ).json()) as DecisionBody
    expect(reAccepted.decision).toBe('accepted')
    expect(await portalRow(cookie, submissionId)).toMatchObject({
      decision: 'accepted',
      accepted: true,
    })
  })

  it('treats a repeated verdict as a no-op that keeps the original instant', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    const first = (await (
      await decide(organizer, submissionId, { decision: 'rejected' })
    ).json()) as DecisionBody
    const repeat = (await (
      await decide(organizer, submissionId, { decision: 'rejected' })
    ).json()) as DecisionBody
    expect(repeat.decision).toBe('rejected')
    expect(repeat.changed).toBe(false)
    expect(repeat.decidedAt).toBe(first.decidedAt)
  })

  it('reads back the current decision, and pending before there is one', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    const before = await app.request(
      decisionPath(submissionId),
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    expect(before.status).toBe(200)
    // Undecided is the word 'pending' on the wire, not null and not absent —
    // one spelling everywhere. `decidedAt` stays null because there is no
    // instant to name until somebody actually decides.
    expect((await before.json()) as DecisionBody).toMatchObject({
      decision: 'pending',
      decidedAt: null,
      history: [],
    })
    await decide(organizer, submissionId, { decision: 'rejected' })
    const after = await app.request(
      decisionPath(submissionId),
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    expect(((await after.json()) as DecisionBody).decision).toBe('rejected')
  })

  it('refuses a verdict that is not one of the two', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    expect((await decide(organizer, submissionId, { decision: 'maybe' })).status).toBe(400)
    expect((await decide(organizer, submissionId, {})).status).toBe(400)
  })

  it('is organizer-only and same-origin only', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    expect((await decide(cookie, submissionId, { decision: 'accepted' })).status).toBe(403)
    const anonymous = await app.request(
      decisionPath(submissionId),
      {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'accepted' }),
      },
      bindings(),
    )
    expect(anonymous.status).toBe(401)
    const organizer = await organizerCookie()
    expect(
      (
        await decide(
          organizer,
          submissionId,
          { decision: 'accepted' },
          'demo-conf-2026',
          'https://evil.test',
        )
      ).status,
    ).toBe(403)
  })

  it('answers a safe 404 for a submission that belongs to another event', async () => {
    await seedOtherEvent()
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    // The id is real; the event in the path is not its event, and the organizer
    // learns nothing beyond 'not here'.
    expect(
      (await decide(organizer, submissionId, { decision: 'accepted' }, OTHER_EVENT_SLUG)).status,
    ).toBe(404)
    const untouched = await app.request(
      decisionPath(submissionId),
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    // Still undecided: the refused write landed nowhere, and 'pending' is how
    // that reads.
    expect(((await untouched.json()) as DecisionBody).decision).toBe('pending')
  })
})

describe('a decision the speaker has acted on is final', () => {
  it('refuses to reverse an acceptance once onboarding work is done', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    expect((await decide(organizer, submissionId, { decision: 'accepted' })).status).toBe(200)

    const tasks = await app.request(
      '/api/public/tasks',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(tasks.status).toBe(200)
    const list = (await tasks.json()) as readonly { id: string; kind: string }[]
    const confirm = list.find((task) => task.kind === 'confirm_participation')
    expect(confirm).toBeDefined()
    const completed = await app.request(
      `/api/public/tasks/${confirm?.id ?? ''}/complete`,
      {
        method: 'POST',
        headers: { cookie: cookieHeader(cookie), origin: ALLOWED_ORIGIN },
      },
      bindings(),
    )
    expect(completed.status).toBe(200)

    const reversal = await decide(organizer, submissionId, { decision: 'rejected' })
    expect(reversal.status).toBe(409)
    // And the verdict the speaker acted on is exactly the one still standing.
    expect((await portalRow(cookie, submissionId)).decision).toBe('accepted')
  })

  it('still allows re-recording the same verdict after the speaker has acted', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    await decide(organizer, submissionId, { decision: 'accepted' })
    const tasks = (await (
      await app.request(
        '/api/public/tasks',
        { headers: { cookie: cookieHeader(cookie) } },
        bindings(),
      )
    ).json()) as readonly { id: string; kind: string }[]
    const confirm = tasks.find((task) => task.kind === 'confirm_participation')
    await app.request(
      `/api/public/tasks/${confirm?.id ?? ''}/complete`,
      { method: 'POST', headers: { cookie: cookieHeader(cookie), origin: ALLOWED_ORIGIN } },
      bindings(),
    )
    const repeat = await decide(organizer, submissionId, { decision: 'accepted' })
    expect(repeat.status).toBe(200)
    expect(((await repeat.json()) as DecisionBody).changed).toBe(false)
  })
})

describe('a rejection reaches everything an acceptance reached', () => {
  /** Accepts a submission, then rejects it, returning the speaker's cookie. */
  async function acceptedThenRejected(): Promise<{ cookie: string; submissionId: string }> {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    expect((await decide(organizer, submissionId, { decision: 'accepted' })).status).toBe(200)
    expect((await decide(organizer, submissionId, { decision: 'rejected' })).status).toBe(200)
    return { cookie, submissionId }
  }

  it('takes the talk off the organizer agenda board', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    await decide(organizer, submissionId, { decision: 'accepted' })

    const board = async (): Promise<readonly { submissionId: string }[]> => {
      const response = await app.request(
        '/api/admin/events/demo-conf-2026/agenda',
        { headers: { cookie: cookieHeader(organizer) } },
        bindings(),
      )
      expect(response.status).toBe(200)
      return ((await response.json()) as { sessions: readonly { submissionId: string }[] }).sessions
    }
    // Acceptance materialises the session, so it is on the board first.
    expect((await board()).map((session) => session.submissionId)).toContain(submissionId)

    await decide(organizer, submissionId, { decision: 'rejected' })
    // The acceptance ROW still exists — speaker_tasks foreign-keys it — but a
    // rejected talk must not be schedulable, let alone publishable.
    expect((await board()).map((session) => session.submissionId)).not.toContain(submissionId)
  })

  it('refuses to place or publish a rejected talk', async () => {
    const { submissionId } = await acceptedThenRejected()
    const organizer = await organizerCookie()
    const placement = await app.request(
      `/api/admin/events/demo-conf-2026/agenda/${submissionId}`,
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          day: '2026-05-13',
          roomId: 'room-a',
          trackId: null,
          start: '2026-05-13T09:00:00.000Z',
          end: '2026-05-13T09:30:00.000Z',
        }),
      },
      bindings(),
    )
    expect(placement.status).toBe(404)

    const published = await app.request(
      '/api/admin/events/demo-conf-2026/agenda/publish',
      { method: 'POST', headers: { cookie: cookieHeader(organizer), origin: ALLOWED_ORIGIN } },
      bindings(),
    )
    expect(published.status).toBe(200)
    expect(((await published.json()) as { publishedCount: number }).publishedCount).toBe(0)
  })

  it('drops the speaker onboarding checklist', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    await decide(organizer, submissionId, { decision: 'accepted' })
    const tasks = async (): Promise<readonly unknown[]> => {
      const response = await app.request(
        '/api/public/tasks',
        { headers: { cookie: cookieHeader(cookie) } },
        bindings(),
      )
      expect(response.status).toBe(200)
      return (await response.json()) as readonly unknown[]
    }
    expect((await tasks()).length).toBeGreaterThan(0)

    await decide(organizer, submissionId, { decision: 'rejected' })
    // Being asked to confirm participation in a talk that was turned down is
    // worse than being told nothing.
    expect(await tasks()).toEqual([])
  })

  it('drops out of organizer readiness', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    await decide(organizer, submissionId, { decision: 'accepted' })
    const readiness = async (): Promise<{ acceptedSubmissions: number; totalTasks: number }> => {
      const response = await app.request(
        '/api/admin/readiness?eventSlug=demo-conf-2026',
        { headers: { cookie: cookieHeader(organizer) } },
        bindings(),
      )
      expect(response.status).toBe(200)
      return (await response.json()) as { acceptedSubmissions: number; totalTasks: number }
    }
    expect((await readiness()).acceptedSubmissions).toBe(1)

    await decide(organizer, submissionId, { decision: 'rejected' })
    // Otherwise a rejected proposal sits in the aggregate for ever at 0% and
    // reads as a speaker who has gone quiet.
    expect(await readiness()).toMatchObject({ acceptedSubmissions: 0, totalTasks: 0 })
  })

  it('refuses the calendar invite to a rejected speaker, and to an undecided one', async () => {
    const invite = async (cookie: string, submissionId: string): Promise<number> => {
      const response = await app.request(
        `/api/public/invite/${submissionId}.ics`,
        { headers: { cookie: cookieHeader(cookie) } },
        bindings(),
      )
      return response.status
    }

    // Undecided: there is nothing to put in a diary yet.
    const undecided = await speakerWithSubmission()
    expect(await invite(undecided.cookie, undecided.submissionId)).toBe(404)

    const organizer = await organizerCookie()
    await decide(organizer, undecided.submissionId, { decision: 'accepted' })
    expect(await invite(undecided.cookie, undecided.submissionId)).toBe(200)

    // A saved .ics keeps claiming its appointment long after any screen would
    // have corrected it, so the rejection has to reach the bytes.
    await decide(organizer, undecided.submissionId, { decision: 'rejected' })
    expect(await invite(undecided.cookie, undecided.submissionId)).toBe(404)
  })

  it('leaves the acceptance row intact so no speaker work is destroyed', async () => {
    const { submissionId } = await acceptedThenRejected()
    const acceptance = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM submission_acceptances WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ n: number }>()
    expect(acceptance?.n).toBe(1)
    const tasks = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM speaker_tasks WHERE submission_id = ?',
    )
      .bind(submissionId)
      .first<{ n: number }>()
    expect((tasks?.n ?? 0) > 0).toBe(true)
  })
})

describe('the decision trail is append-only', () => {
  it('records every transition, not just where the proposal ended up', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    await decide(organizer, submissionId, { decision: 'accepted' })
    await decide(organizer, submissionId, { decision: 'rejected' })
    // A repeat of the standing verdict must not grow the trail: history is a
    // record of someone changing their mind, not of clicks.
    await decide(organizer, submissionId, { decision: 'rejected' })
    const final = (await (
      await decide(organizer, submissionId, { decision: 'accepted' })
    ).json()) as DecisionBody

    expect(final.decision).toBe('accepted')
    expect(final.history.map((entry) => entry.decision)).toEqual([
      'accepted',
      'rejected',
      'accepted',
    ])
    expect(final.history.map((entry) => entry.sequence)).toEqual([1, 2, 3])
    expect(final.history.every((entry) => entry.decidedBy === 'organizer')).toBe(true)
    expect(final.history.every((entry) => entry.decidedAt.length === 24)).toBe(true)
  })
})

describe('the reject route mirrors the accept route', () => {
  const rejectPath = (submissionId: string, slug = 'demo-conf-2026'): string =>
    `/api/admin/events/${slug}/submissions/${submissionId}/reject`

  async function reject(
    cookie: string,
    submissionId: string,
    slug = 'demo-conf-2026',
    origin = ALLOWED_ORIGIN,
  ): Promise<Response> {
    return app.request(
      rejectPath(submissionId, slug),
      { method: 'POST', headers: { cookie: cookieHeader(cookie), origin } },
      bindings(),
    )
  }

  it('records the rejection and shows it in the portal', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    const response = await reject(organizer, submissionId)
    expect(response.status).toBe(200)
    expect((await response.json()) as DecisionBody).toMatchObject({ decision: 'rejected' })
    expect((await portalRow(cookie, submissionId)).decision).toBe('rejected')
  })

  it('is organizer-only, same-origin only, and event-scoped', async () => {
    await seedOtherEvent()
    const { cookie, submissionId } = await speakerWithSubmission()
    expect((await reject(cookie, submissionId)).status).toBe(403)
    const anonymous = await app.request(
      rejectPath(submissionId),
      { method: 'POST', headers: { origin: ALLOWED_ORIGIN } },
      bindings(),
    )
    expect(anonymous.status).toBe(401)
    const organizer = await organizerCookie()
    expect(
      (await reject(organizer, submissionId, 'demo-conf-2026', 'https://evil.test')).status,
    ).toBe(403)
    expect((await reject(organizer, submissionId, OTHER_EVENT_SLUG)).status).toBe(404)
  })
})

describe('provisioning reuses an identity and never rewrites it', () => {
  it('seats an existing speaker without touching their own profile', async () => {
    // Ada is a seeded SPEAKER. Inviting her onto the committee must reuse her
    // contact row: an organizer typing a name into an invite box must not be
    // able to rename a person who already exists.
    const before = await env.DB.prepare('SELECT id, name FROM contacts WHERE email = ?')
      .bind('speaker.ada@example.test')
      .first<{ id: string; name: string }>()
    expect(before?.name).toBe('Ada Speaker')

    const organizer = await organizerCookie()
    const response = await inviteReviewer(organizer, {
      email: 'speaker.ada@example.test',
      name: 'Renamed By Organizer',
    })
    expect(response.status).toBe(200)
    const member = (await response.json()) as CommitteeMemberBody
    expect(member.contactId).toBe(before?.id)

    const after = await env.DB.prepare('SELECT name, bio FROM contacts WHERE email = ?')
      .bind('speaker.ada@example.test')
      .first<{ name: string; bio: string | null }>()
    expect(after?.name).toBe('Ada Speaker')
    expect(member.name).toBe('Ada Speaker')
    // The seat exists all the same — reuse is not refusal.
    expect(await committeeRowCount(member.contactId, DEMO_CONF_2026_ID)).toBe(1)
  })

  it('grants a seated speaker no reach into anyone else’s proposals', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    const member = (await (
      await inviteReviewer(organizer, { email: 'speaker.ada@example.test' })
    ).json()) as CommitteeMemberBody
    // `created` is about the SEAT, not the person: Ada already existed, and the
    // seat on this committee is new.
    expect(member.created).toBe(true)

    // A committee seat is a seat, not a key: with no assignment there is
    // nothing to read, and the proposal itself stays out of reach.
    const { cookie } = await reviewerSignIn('speaker.ada@example.test')
    const queue = await app.request(
      '/api/public/evaluations',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(await queue.json()).toEqual([])
    const stranger = await app.request(
      `/api/public/submission/${submissionId}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(stranger.status).toBe(404)
  })
})

describe('an organizer can read what the committee actually said', () => {
  it('carries each reviewer rating and comment, and says who has not answered', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    for (const email of ['reviewer.one@example.test', 'reviewer.two@example.test']) {
      const assigned = await app.request(
        `/api/admin/events/demo-conf-2026/submissions/${submissionId}/assignments`,
        {
          method: 'POST',
          headers: {
            cookie: cookieHeader(organizer),
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ evaluatorEmail: email }),
        },
        bindings(),
      )
      expect(assigned.status).toBe(200)
    }

    // Only reviewer one answers.
    const reviewer = await submitterCookie(env.DB, {}, 'reviewer.one@example.test')
    const scored = await app.request(
      '/api/public/evaluations',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(reviewer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          submissionId,
          rating: 4,
          comments: 'Strong, needs a sharper demo.',
        }),
      },
      bindings(),
    )
    expect(scored.status).toBe(200)

    const summary = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    expect(summary.status).toBe(200)
    const body = (await summary.json()) as {
      reviews: readonly {
        evaluatorEmail: string
        rating: number | null
        comment: string | null
        updatedAt: string | null
      }[]
    }
    const answered = body.reviews.find((r) => r.evaluatorEmail === 'reviewer.one@example.test')
    expect(answered?.rating).toBe(4)
    expect(answered?.comment).toBe('Strong, needs a sharper demo.')
    expect(answered?.updatedAt).toHaveLength(24)
    // An unscored reviewer is reported as unscored rather than dropped: 'one of
    // two has read this' is a different fact from 'one review exists'.
    const silent = body.reviews.find((r) => r.evaluatorEmail === 'reviewer.two@example.test')
    expect(silent).toBeDefined()
    expect(silent?.rating).toBeNull()
    expect(silent?.comment).toBeNull()

    // The roster carries the same two facts.
    const roster = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/assignments`,
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    const rows = (await roster.json()) as readonly {
      evaluatorEmail: string
      rating: number | null
      comment: string | null
    }[]
    expect(rows.find((r) => r.evaluatorEmail === 'reviewer.one@example.test')?.comment).toBe(
      'Strong, needs a sharper demo.',
    )
  })

  it('never lets a reviewer read another reviewer’s words', async () => {
    const { submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    for (const email of ['reviewer.one@example.test', 'reviewer.two@example.test']) {
      await app.request(
        `/api/admin/events/demo-conf-2026/submissions/${submissionId}/assignments`,
        {
          method: 'POST',
          headers: {
            cookie: cookieHeader(organizer),
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ evaluatorEmail: email }),
        },
        bindings(),
      )
    }
    const one = await submitterCookie(env.DB, {}, 'reviewer.one@example.test')
    await app.request(
      '/api/public/evaluations',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(one),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ submissionId, rating: 5, comments: 'Private to reviewer one.' }),
      },
      bindings(),
    )

    // Reviewer two's own surface shows their own empty row and nothing else.
    const two = await submitterCookie(env.DB, {}, 'reviewer.two@example.test')
    const queue = await app.request(
      '/api/public/evaluations',
      { headers: { cookie: cookieHeader(two) } },
      bindings(),
    )
    expect(JSON.stringify(await queue.json())).not.toContain('Private to reviewer one.')

    // And the organizer-only shape is not reachable with a reviewer session.
    const summary = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      { headers: { cookie: cookieHeader(two) } },
      bindings(),
    )
    expect(summary.status).toBe(403)
  })
})
