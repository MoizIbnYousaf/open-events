import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import app from '../../src/server'
import {
  DEMO_CONF_2026_CRITERION_ID,
  DEMO_CONF_2026_ID,
  DEMO_CONF_2026_REVIEWER_ONE_ID,
  DEMO_CONF_2026_ROUND_ID,
  DEMO_CONF_2026_VERSION_ID,
} from '../../src/db'
import { SEEDED_WORKSHOP_ANSWERS, applyMigrations, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'

// Committee evaluation API contract. An organizer defines weighted criteria
// and review rounds, assigns evaluators to submissions and reads the weighted
// totals; an evaluator sees exactly the submissions they were assigned and
// scores only those. Every route runs through the real application with real
// sessions and the real CSRF gate.

const SPEAKER_EMAIL = 'speaker-a@example.test'
const REVIEWER_ONE_EMAIL = 'reviewer.one@example.test'
const REVIEWER_TWO_EMAIL = 'reviewer.two@example.test'
const CRITERIA_PATH = '/api/admin/events/demo-conf-2026/criteria'
const ROUNDS_PATH = '/api/admin/events/demo-conf-2026/rounds'
const EVALUATIONS_PATH = '/api/public/evaluations'
const NOW = '2026-08-10T09:00:00.000Z'
const OTHER_EVENT_ID = 'event-other-conf'

interface CriterionBody {
  readonly id: string
  readonly eventId: string
  readonly name: string
  readonly weight: number
  readonly position: number
}

interface RoundBody {
  readonly id: string
  readonly eventId: string
  readonly number: number
  readonly name: string
  readonly status: string
}

interface AssignmentBody {
  readonly id: string
  readonly roundId: string
  readonly submissionId: string
  readonly evaluatorContactId: string
  readonly evaluatorEmail: string
  readonly evaluatorName: string
  readonly createdAt: string
}

interface PreviousRoundBody {
  readonly roundNumber: number
  readonly roundName: string
  readonly rating: number
  readonly comments: string | null
  readonly updatedAt: string
}

interface RowBody {
  readonly submissionId: string
  readonly sessionTitle: string
  readonly roundId: string
  readonly roundNumber: number
  readonly roundName: string
  readonly roundStatus: string
  readonly rating: number | null
  readonly comments: string | null
  readonly updatedAt: string | null
  readonly previousRounds: readonly PreviousRoundBody[]
}

interface CriterionSummaryBody {
  readonly criterionId: string
  readonly name: string
  readonly weight: number
  readonly scoreCount: number
  readonly ratingSum: number
}

interface RoundSummaryBody {
  readonly roundId: string
  readonly number: number
  readonly name: string
  readonly status: string
  readonly assignmentCount: number
  readonly scoredCount: number
  readonly scoreCount: number
  readonly weightSum: number
  readonly weightedTotal: number
  readonly weightedAverageCentis: number
  readonly criteria: readonly CriterionSummaryBody[]
}

interface SummaryBody {
  readonly submissionId: string
  readonly title: string
  readonly currentRoundId: string | null
  readonly assignmentCount: number
  readonly scoredCount: number
  readonly scoreCount: number
  readonly weightSum: number
  readonly weightedTotal: number
  readonly weightedAverageCentis: number
  readonly criteria: readonly CriterionSummaryBody[]
  readonly rounds: readonly RoundSummaryBody[]
}

/** The wire shape of an assigned submission nobody has scored yet. */
function unscoredRow(overrides: Partial<RowBody> = {}): RowBody {
  return {
    submissionId,
    sessionTitle: 'Workshop proposal',
    roundId: DEMO_CONF_2026_ROUND_ID,
    roundNumber: 1,
    roundName: 'Round 1',
    roundStatus: 'open',
    rating: null,
    comments: null,
    updatedAt: null,
    previousRounds: [],
    ...overrides,
  }
}

let organizerToken: string
let speakerCookie: string
let reviewerOneCookie: string
let reviewerTwoCookie: string
let submissionId: string

async function submitProposal(cookie: string, title: string): Promise<string> {
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
  const body = (await response.json()) as { id: string }
  return body.id
}

async function organizerPost(
  path: string,
  body?: unknown,
  cookie = organizerToken,
): Promise<Response> {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  )
}

async function organizerGet(path: string, cookie = organizerToken): Promise<Response> {
  return app.request(path, { headers: { cookie: cookieHeader(cookie) } }, bindings())
}

async function evaluatorGet(cookie: string): Promise<Response> {
  return app.request(EVALUATIONS_PATH, { headers: { cookie: cookieHeader(cookie) } }, bindings())
}

async function evaluatorPost(
  cookie: string,
  body: unknown,
  origin = ALLOWED_ORIGIN,
): Promise<Response> {
  return app.request(
    EVALUATIONS_PATH,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(cookie),
        origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    bindings(),
  )
}

async function assignReviewer(email: string, target = submissionId): Promise<Response> {
  return organizerPost(`/api/admin/events/demo-conf-2026/submissions/${target}/assignments`, {
    evaluatorEmail: email,
  })
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
  const login = await loginOrganizer()
  if (login.token === null) throw new Error('organizer login set no cookie')
  organizerToken = login.token
  speakerCookie = await submitterCookie(env.DB, {}, SPEAKER_EMAIL)
  submissionId = await submitProposal(speakerCookie, 'Workshop proposal')
  reviewerOneCookie = await submitterCookie(env.DB, {}, REVIEWER_ONE_EMAIL)
  reviewerTwoCookie = await submitterCookie(env.DB, {}, REVIEWER_TWO_EMAIL)
})

describe('organizer criteria and rounds', () => {
  it('requires an organizer session and a same-origin mutation', async () => {
    const anonymous = await app.request(
      CRITERIA_PATH,
      {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ criteria: [{ name: 'Overall fit', weight: 1, position: 0 }] }),
      },
      bindings(),
    )
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' },
    })

    const submitter = await organizerPost(
      CRITERIA_PATH,
      { criteria: [{ name: 'Overall fit', weight: 1, position: 0 }] },
      speakerCookie,
    )
    expect(submitter.status).toBe(403)
    expect(await submitter.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } })

    const crossOrigin = await app.request(
      CRITERIA_PATH,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(organizerToken),
          origin: 'http://evil.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ criteria: [{ name: 'Relevance', weight: 2, position: 1 }] }),
      },
      bindings(),
    )
    expect(crossOrigin.status).toBe(403)
  })

  it('defines weighted criteria on top of the seeded default and lists them in order', async () => {
    const seeded = (await (await organizerGet(CRITERIA_PATH)).json()) as readonly CriterionBody[]
    expect(seeded).toEqual([
      {
        id: DEMO_CONF_2026_CRITERION_ID,
        eventId: DEMO_CONF_2026_ID,
        name: 'Overall fit',
        weight: 1,
        position: 0,
      },
    ])

    const response = await organizerPost(CRITERIA_PATH, {
      criteria: [
        { name: 'Relevance', weight: 3, position: 1 },
        { name: 'Overall fit', weight: 2, position: 0 },
      ],
    })
    expect(response.status).toBe(200)
    const defined = (await response.json()) as readonly CriterionBody[]
    expect(defined.map((criterion) => criterion.name)).toEqual(['Overall fit', 'Relevance'])
    expect(defined.map((criterion) => criterion.weight)).toEqual([2, 3])
    expect(defined[0]?.id).toBe(DEMO_CONF_2026_CRITERION_ID)
  })

  it('orders a shared position by code unit, the collation the D1 adapter uses', async () => {
    const response = await organizerPost(CRITERIA_PATH, {
      criteria: [
        { name: 'audience', weight: 1, position: 1 },
        { name: 'Zeal', weight: 1, position: 1 },
      ],
    })
    expect(response.status).toBe(200)

    const listed = (await (await organizerGet(CRITERIA_PATH)).json()) as readonly CriterionBody[]
    // SQLite BINARY puts 'Z' (0x5A) before 'a' (0x61); a locale-aware
    // comparator would answer the other way round.
    expect(listed.map((criterion) => criterion.name)).toEqual(['Overall fit', 'Zeal', 'audience'])
  })

  it('409s a criterion that would move the default away from a scored one', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    await evaluatorPost(reviewerOneCookie, { submissionId, rating: 5 })

    const response = await organizerPost(CRITERIA_PATH, {
      criteria: [{ name: 'Clarity', weight: 4, position: 0 }],
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'conflict', message: 'Conflict' } })

    const listed = (await (await organizerGet(CRITERIA_PATH)).json()) as readonly CriterionBody[]
    expect(listed.map((criterion) => criterion.name)).toEqual(['Overall fit'])
    const rows = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(rows[0]?.rating).toBe(5)
    const summary = (await (
      await organizerGet(
        `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      )
    ).json()) as SummaryBody
    expect(summary.scoreCount).toBe(1)
    expect(summary.weightedTotal).toBe(5)
  })

  it('rejects an invalid criterion body with the validation envelope', async () => {
    const bad = await organizerPost(CRITERIA_PATH, { criteria: 'nope' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })

    const zeroWeight = await organizerPost(CRITERIA_PATH, {
      criteria: [{ name: 'Zero', weight: 0, position: 0 }],
    })
    expect(zeroWeight.status).toBe(400)
  })

  it('lists the seeded open round, opens another and closes one exactly once', async () => {
    const seeded = (await (await organizerGet(ROUNDS_PATH)).json()) as readonly RoundBody[]
    expect(seeded).toEqual([
      {
        id: DEMO_CONF_2026_ROUND_ID,
        eventId: DEMO_CONF_2026_ID,
        number: 1,
        name: 'Round 1',
        status: 'open',
        // The round's own configuration, added in 0017. A seeded round is
        // undated and open to the whole committee until an organizer says
        // otherwise, and says so in fields rather than by omitting them.
        opensAt: null,
        closesAt: null,
        anonymize: false,
      },
    ])

    const opened = await organizerPost(ROUNDS_PATH, { number: 2, name: 'Round 2' })
    expect(opened.status).toBe(200)
    expect(((await opened.json()) as RoundBody).status).toBe('open')

    const closed = await organizerPost(
      `/api/admin/events/demo-conf-2026/rounds/${DEMO_CONF_2026_ROUND_ID}/close`,
    )
    expect(closed.status).toBe(200)
    expect(((await closed.json()) as RoundBody).status).toBe('closed')

    const again = await organizerPost(
      `/api/admin/events/demo-conf-2026/rounds/${DEMO_CONF_2026_ROUND_ID}/close`,
    )
    expect(((await again.json()) as RoundBody).status).toBe('closed')

    const missing = await organizerPost(
      '/api/admin/events/demo-conf-2026/rounds/round-missing/close',
    )
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })
})

describe('organizer assignments', () => {
  it('assigns an evaluator by email, is idempotent and lists the roster', async () => {
    const response = await assignReviewer(REVIEWER_ONE_EMAIL)
    expect(response.status).toBe(200)
    const assignment = (await response.json()) as AssignmentBody
    expect(assignment.submissionId).toBe(submissionId)
    expect(assignment.roundId).toBe(DEMO_CONF_2026_ROUND_ID)
    expect(assignment.evaluatorContactId).toBe(DEMO_CONF_2026_REVIEWER_ONE_ID)
    expect(assignment.evaluatorEmail).toBe(REVIEWER_ONE_EMAIL)

    const again = (await (await assignReviewer(REVIEWER_ONE_EMAIL)).json()) as AssignmentBody
    expect(again.id).toBe(assignment.id)

    await assignReviewer(REVIEWER_TWO_EMAIL)
    const roster = (await (
      await organizerGet(`/api/admin/events/demo-conf-2026/submissions/${submissionId}/assignments`)
    ).json()) as readonly AssignmentBody[]
    expect(roster).toHaveLength(2)
    expect(roster.map((row) => row.evaluatorEmail)).toEqual([
      REVIEWER_ONE_EMAIL,
      REVIEWER_TWO_EMAIL,
    ])
  })

  it('404s an unknown submission, provisions a never-seen reviewer, 400s a malformed email', async () => {
    const unknownSubmission = await assignReviewer(REVIEWER_ONE_EMAIL, 'submission-missing')
    expect(unknownSubmission.status).toBe(404)

    // An email nobody has signed in with is a reviewer the organizer has not
    // met yet, not a mistake: the assignment provisions the identity rather
    // than making the organizer wait for that person to turn up first.
    const coldReviewer = await assignReviewer('nobody@example.test')
    expect(coldReviewer.status).toBe(200)
    expect((await coldReviewer.json()) as AssignmentBody).toMatchObject({
      evaluatorEmail: 'nobody@example.test',
    })

    const malformed = await assignReviewer('not-an-email')
    expect(malformed.status).toBe(400)
  })

  it('409s an assignment once every round is closed', async () => {
    await organizerPost(`/api/admin/events/demo-conf-2026/rounds/${DEMO_CONF_2026_ROUND_ID}/close`)

    const response = await assignReviewer(REVIEWER_ONE_EMAIL)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'conflict', message: 'Conflict' } })
  })
})

describe('evaluator surface', () => {
  it('gives a committee member with nothing assigned an empty list, and 403s everyone else', async () => {
    // An empty review queue is an empty queue, not a locked door: reviewer.one
    // is on the seeded committee and simply has nothing to score yet.
    const noAssignments = await evaluatorGet(reviewerOneCookie)
    expect(noAssignments.status).toBe(200)
    expect(await noAssignments.json()).toEqual([])

    // A speaker was never put on the committee, so the surface stays invisible.
    const speaker = await evaluatorGet(speakerCookie)
    expect(speaker.status).toBe(403)
    expect(await speaker.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } })

    const anonymous = await app.request(EVALUATIONS_PATH, undefined, bindings())
    expect(anonymous.status).toBe(401)

    const organizer = await evaluatorGet(organizerToken)
    expect(organizer.status).toBe(403)
  })

  it('lands a committee member on their reviews and a speaker on the CFP form', async () => {
    async function redeemLocation(email: string): Promise<string | null> {
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
      const raw = decodeURIComponent(message?.body.split('token=')[1] ?? '')
      const redeemed = await app.request(
        `/api/public/session?token=${encodeURIComponent(raw)}`,
        undefined,
        bindings(),
      )
      expect(redeemed.status).toBe(303)
      return redeemed.headers.get('location')
    }

    // A reviewer signing in is there to review, not to write a proposal.
    expect(await redeemLocation(REVIEWER_ONE_EMAIL)).toBe('/evaluations')
    expect(await redeemLocation('speaker-b@example.test')).toBe('/cfp/demo-conf-2026/cfp')
  })

  it('puts an evaluator on the committee the moment the organizer assigns them', async () => {
    const outsider = await submitterCookie(env.DB, {}, 'new.reviewer@example.test')
    expect((await evaluatorGet(outsider)).status).toBe(403)

    await assignReviewer('new.reviewer@example.test')

    // Assigning is how someone joins the committee, so the surface opens for
    // them without a second organizer step.
    const opened = await evaluatorGet(outsider)
    expect(opened.status).toBe(200)
    expect((await opened.json()) as readonly RowBody[]).toHaveLength(1)
  })

  it('returns a JSON array of the assigned rows, unscored rows included', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)

    const response = await evaluatorGet(reviewerOneCookie)
    expect(response.status).toBe(200)
    const rows = (await response.json()) as readonly RowBody[]
    expect(Array.isArray(rows)).toBe(true)
    expect(rows).toEqual([unscoredRow()])
  })

  it('never puts an off-scale rating on the wire for an unscored assignment', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)

    const rows = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(rows[0]?.rating).toBeNull()
    expect(rows[0]?.comments).toBeNull()
    expect(rows[0]?.updatedAt).toBeNull()

    // 0 is not a rating, so it is refused rather than quietly stored — and the
    // read side no longer emits it either, so nothing round-trips into a 400.
    const zero = await evaluatorPost(reviewerOneCookie, { submissionId, rating: 0 })
    expect(zero.status).toBe(400)
    expect(await zero.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })
    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluation_scores').first<{
      n: number
    }>()
    expect(stored?.n).toBe(0)
  })

  it('rejects a post with no rating and never writes a default', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)

    const missingRating = await evaluatorPost(reviewerOneCookie, { submissionId })
    expect(missingRating.status).toBe(400)
    expect(await missingRating.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })

    const nullRating = await evaluatorPost(reviewerOneCookie, { submissionId, rating: null })
    expect(nullRating.status).toBe(400)

    const rows = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(rows[0]?.rating).toBeNull()
    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluation_scores').first<{
      n: number
    }>()
    expect(stored?.n).toBe(0)
  })

  it('keeps a stored comment when a later post omits the comments key', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    const first = await evaluatorPost(reviewerOneCookie, {
      submissionId,
      rating: 4,
      comments: 'Strong fit',
    })
    expect(((await first.json()) as RowBody).comments).toBe('Strong fit')

    // Exactly what a rating-only edit sends: no `comments` key at all.
    const second = await evaluatorPost(reviewerOneCookie, { submissionId, rating: 2 })
    expect(second.status).toBe(200)

    const listed = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(listed[0]?.rating).toBe(2)
    expect(listed[0]?.comments).toBe('Strong fit')
  })

  it('clears a stored comment only when the post carries an explicit empty one', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    await evaluatorPost(reviewerOneCookie, { submissionId, rating: 4, comments: 'Strong fit' })

    const cleared = await evaluatorPost(reviewerOneCookie, {
      submissionId,
      rating: 4,
      comments: '',
    })
    expect(cleared.status).toBe(200)
    expect(((await cleared.json()) as RowBody).comments).toBeNull()

    await evaluatorPost(reviewerOneCookie, { submissionId, rating: 4, comments: 'Second look' })
    const nulled = await evaluatorPost(reviewerOneCookie, {
      submissionId,
      rating: 4,
      comments: null,
    })
    expect(((await nulled.json()) as RowBody).comments).toBeNull()
  })

  it('records a rating idempotently and never leaks another evaluator work', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    await assignReviewer(REVIEWER_TWO_EMAIL)

    const first = await evaluatorPost(reviewerOneCookie, {
      submissionId,
      rating: 4,
      comments: 'Strong fit',
    })
    expect(first.status).toBe(200)
    const row = (await first.json()) as RowBody
    expect(row.rating).toBe(4)
    expect(row.comments).toBe('Strong fit')
    expect(row.sessionTitle).toBe('Workshop proposal')
    expect(row.updatedAt?.length).toBe(24)

    const second = await evaluatorPost(reviewerOneCookie, { submissionId, rating: 2 })
    expect(second.status).toBe(200)
    expect(((await second.json()) as RowBody).rating).toBe(2)

    const listed = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(listed).toHaveLength(1)
    expect(listed[0]?.rating).toBe(2)
    // The rating-only edit changed the rating and nothing else: a written
    // justification is never collateral damage.
    expect(listed[0]?.comments).toBe('Strong fit')

    const otherRows = (await (await evaluatorGet(reviewerTwoCookie)).json()) as readonly RowBody[]
    expect(otherRows).toEqual([unscoredRow()])

    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluation_scores').first<{
      n: number
    }>()
    expect(stored?.n).toBe(1)
  })

  it('refuses a submission the evaluator was never assigned', async () => {
    const otherSubmissionId = await submitProposal(speakerCookie, 'Second proposal')
    await assignReviewer(REVIEWER_ONE_EMAIL)

    const foreign = await evaluatorPost(reviewerOneCookie, {
      submissionId: otherSubmissionId,
      rating: 5,
    })
    expect(foreign.status).toBe(403)

    const unassigned = await evaluatorPost(reviewerTwoCookie, { submissionId, rating: 5 })
    expect(unassigned.status).toBe(403)

    const rows = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(rows.map((entry) => entry.submissionId)).toEqual([submissionId])
  })

  it('rejects an out-of-scale rating, a malformed body and a cross-origin post', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)

    for (const rating of [0, 6, 2.5, '4']) {
      const response = await evaluatorPost(reviewerOneCookie, { submissionId, rating })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: { code: 'validation_failed', message: 'Validation failed' },
      })
    }

    const missingSubmission = await evaluatorPost(reviewerOneCookie, { rating: 3 })
    expect(missingSubmission.status).toBe(400)

    const crossOrigin = await evaluatorPost(
      reviewerOneCookie,
      { submissionId, rating: 3 },
      'http://evil.test',
    )
    expect(crossOrigin.status).toBe(403)
  })

  it('409s a score once the round is closed and keeps the earlier rating', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    await evaluatorPost(reviewerOneCookie, { submissionId, rating: 5 })
    await organizerPost(`/api/admin/events/demo-conf-2026/rounds/${DEMO_CONF_2026_ROUND_ID}/close`)

    const response = await evaluatorPost(reviewerOneCookie, { submissionId, rating: 1 })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'conflict', message: 'Conflict' } })

    const rows = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(rows[0]?.rating).toBe(5)
  })

  it('returns one row per submission when a second round re-assigns the same evaluator', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    await evaluatorPost(reviewerOneCookie, { submissionId, rating: 5, comments: 'Round one view' })
    await organizerPost(`/api/admin/events/demo-conf-2026/rounds/${DEMO_CONF_2026_ROUND_ID}/close`)
    const roundTwo = (await (
      await organizerPost(ROUNDS_PATH, { number: 2, name: 'Round 2' })
    ).json()) as RoundBody
    await assignReviewer(REVIEWER_ONE_EMAIL)

    const roster = (await (
      await organizerGet(`/api/admin/events/demo-conf-2026/submissions/${submissionId}/assignments`)
    ).json()) as readonly AssignmentBody[]
    expect(roster).toHaveLength(2)
    expect(roster[1]?.roundId).toBe(roundTwo.id)

    const rows = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    // The row names the round it belongs to, and carries what this evaluator
    // recorded in the round that already finished.
    expect(rows).toEqual([
      unscoredRow({
        roundId: roundTwo.id,
        roundNumber: 2,
        roundName: 'Round 2',
        previousRounds: [
          {
            roundNumber: 1,
            roundName: 'Round 1',
            rating: 5,
            comments: 'Round one view',
            updatedAt: rows[0]?.previousRounds[0]?.updatedAt ?? '',
          },
        ],
      }),
    ])
    expect(rows[0]?.previousRounds[0]?.updatedAt.length).toBe(24)

    const written = await evaluatorPost(reviewerOneCookie, { submissionId, rating: 2 })
    expect(written.status).toBe(200)
    const after = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(after).toHaveLength(1)
    expect(after[0]?.rating).toBe(2)
  })

  it('never surfaces an assignment that belongs to another event', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    await seedForeignAssignment()

    const rows = (await (await evaluatorGet(reviewerOneCookie)).json()) as readonly RowBody[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.submissionId).toBe(submissionId)
  })
})

describe('organizer weighted summary', () => {
  it('weights two criteria of different weights across two evaluators', async () => {
    await organizerPost(CRITERIA_PATH, {
      criteria: [
        { name: 'Overall fit', weight: 2, position: 0 },
        { name: 'Relevance', weight: 3, position: 1 },
      ],
    })
    const criteria = (await (await organizerGet(CRITERIA_PATH)).json()) as readonly CriterionBody[]
    const relevanceId = criteria[1]?.id ?? ''
    const firstAssignment = (await (
      await assignReviewer(REVIEWER_ONE_EMAIL)
    ).json()) as AssignmentBody
    await assignReviewer(REVIEWER_TWO_EMAIL)

    // Both evaluators rate the default criterion through the public surface.
    await evaluatorPost(reviewerOneCookie, { submissionId, rating: 4 })
    await evaluatorPost(reviewerTwoCookie, { submissionId, rating: 3 })
    // The second criterion is scored directly: the evaluator surface writes one
    // rating per submission, while the summary reads every stored score of the
    // assignments it counts.
    await env.DB.prepare(
      `INSERT INTO evaluation_scores
         (event_id, id, assignment_id, criterion_id, rating, comment, created_at, updated_at)
       VALUES (?, 'score-relevance', ?, ?, 5, NULL, ?, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, firstAssignment.id, relevanceId, NOW, NOW)
      .run()

    const response = await organizerGet(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
    )
    expect(response.status).toBe(200)
    const summary = (await response.json()) as SummaryBody
    expect(summary.submissionId).toBe(submissionId)
    expect(summary.title).toBe('Workshop proposal')
    expect(summary.assignmentCount).toBe(2)
    expect(summary.scoreCount).toBe(3)
    // 4x2 + 3x2 + 5x3 = 29 over a weight sum of 7 -> 414.28... -> 414 centis.
    expect(summary.weightSum).toBe(7)
    expect(summary.weightedTotal).toBe(29)
    expect(summary.weightedAverageCentis).toBe(414)
    expect(summary.criteria).toEqual([
      {
        criterionId: DEMO_CONF_2026_CRITERION_ID,
        name: 'Overall fit',
        weight: 2,
        scoreCount: 2,
        ratingSum: 7,
      },
      { criterionId: relevanceId, name: 'Relevance', weight: 3, scoreCount: 1, ratingSum: 5 },
    ])
    expect(summary.currentRoundId).toBe(DEMO_CONF_2026_ROUND_ID)
    expect(summary.scoredCount).toBe(2)
    expect(summary.rounds).toHaveLength(1)
    expect(summary.rounds[0]).toMatchObject({
      roundId: DEMO_CONF_2026_ROUND_ID,
      number: 1,
      status: 'open',
      assignmentCount: 2,
      scoredCount: 2,
      scoreCount: 3,
      weightSum: 7,
      weightedTotal: 29,
      weightedAverageCentis: 414,
    })
  })

  it('keeps a closed round reporting the rubric it concluded under', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    await evaluatorPost(reviewerOneCookie, { submissionId, rating: 5 })
    await organizerPost(`/api/admin/events/demo-conf-2026/rounds/${DEMO_CONF_2026_ROUND_ID}/close`)

    const sealed = (await (
      await organizerGet(
        `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      )
    ).json()) as SummaryBody
    expect(sealed.rounds[0]).toMatchObject({
      status: 'closed',
      weightSum: 1,
      weightedTotal: 5,
      weightedAverageCentis: 500,
    })

    // The organizer retunes the rubric for the next round.
    const retuned = await organizerPost(CRITERIA_PATH, {
      criteria: [{ name: 'Overall fit', weight: 2, position: 0 }],
    })
    expect(retuned.status).toBe(200)

    const after = (await (
      await organizerGet(
        `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      )
    ).json()) as SummaryBody
    expect(after.rounds[0]).toEqual(sealed.rounds[0])
  })

  it('counts a re-assigned evaluator once, on the rating they can still change', async () => {
    await assignReviewer(REVIEWER_ONE_EMAIL)
    await evaluatorPost(reviewerOneCookie, { submissionId, rating: 5 })
    await organizerPost(`/api/admin/events/demo-conf-2026/rounds/${DEMO_CONF_2026_ROUND_ID}/close`)
    const roundTwo = (await (
      await organizerPost(ROUNDS_PATH, { number: 2, name: 'Round 2' })
    ).json()) as RoundBody
    await assignReviewer(REVIEWER_ONE_EMAIL)
    const rescored = await evaluatorPost(reviewerOneCookie, { submissionId, rating: 1 })
    expect(rescored.status).toBe(200)

    // Both rounds are on the roster and both ratings are stored: only the
    // counting changes, never the record.
    const roster = (await (
      await organizerGet(`/api/admin/events/demo-conf-2026/submissions/${submissionId}/assignments`)
    ).json()) as readonly AssignmentBody[]
    expect(roster.map((row) => row.evaluatorEmail)).toEqual([
      REVIEWER_ONE_EMAIL,
      REVIEWER_ONE_EMAIL,
    ])
    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluation_scores').first<{
      n: number
    }>()
    expect(stored?.n).toBe(2)

    const summary = (await (
      await organizerGet(
        `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      )
    ).json()) as SummaryBody
    expect(summary.currentRoundId).toBe(roundTwo.id)
    expect(summary.assignmentCount).toBe(1)
    expect(summary.scoreCount).toBe(1)
    expect(summary.weightSum).toBe(1)
    expect(summary.weightedTotal).toBe(1)
    expect(summary.weightedAverageCentis).toBe(100)
    expect(summary.criteria).toEqual([
      {
        criterionId: DEMO_CONF_2026_CRITERION_ID,
        name: 'Overall fit',
        weight: 1,
        scoreCount: 1,
        ratingSum: 1,
      },
    ])
    // Round 1 is still readable, and still says what it concluded.
    expect(summary.rounds.map((entry) => entry.number)).toEqual([1, 2])
    expect(summary.rounds[0]).toMatchObject({
      roundId: DEMO_CONF_2026_ROUND_ID,
      status: 'closed',
      assignmentCount: 1,
      scoredCount: 1,
      scoreCount: 1,
      weightedTotal: 5,
      weightedAverageCentis: 500,
    })
  })

  it('reports zeros before any score and denies a non-organizer', async () => {
    const summary = (await (
      await organizerGet(
        `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      )
    ).json()) as SummaryBody
    expect(summary.currentRoundId).toBe(DEMO_CONF_2026_ROUND_ID)
    expect(summary.scoreCount).toBe(0)
    expect(summary.scoredCount).toBe(0)
    expect(summary.weightedTotal).toBe(0)
    expect(summary.weightedAverageCentis).toBe(0)
    expect(summary.rounds).toHaveLength(1)

    const submitter = await organizerGet(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      speakerCookie,
    )
    expect(submitter.status).toBe(403)

    const missing = await organizerGet(
      '/api/admin/events/demo-conf-2026/submissions/submission-missing/assignments',
    )
    expect(missing.status).toBe(404)
  })
})

/**
 * Builds a complete second event with its own round and an assignment for the
 * same reviewer contact, so the evaluator list can be proven event-scoped.
 */
async function seedForeignAssignment(): Promise<void> {
  await env.DB.prepare('INSERT INTO events (id, slug, name, timezone, status) VALUES (?,?,?,?,?)')
    .bind(OTHER_EVENT_ID, 'other-conf', 'Other Conf', 'Europe/Berlin', 'draft')
    .run()
  await env.DB.prepare(
    `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                            opens_at, closes_at, total_cap, per_identity_limit)
     VALUES (?, 'form-other', 'cfp', 'draft', NULL, NULL, NULL, NULL, NULL)`,
  )
    .bind(OTHER_EVENT_ID)
    .run()
  await env.DB.prepare(
    `INSERT INTO cfp_form_versions (event_id, id, form_id, version, status,
                                    content_hash, published_at, updated_at)
     VALUES (?, 'version-other', 'form-other', 1, 'draft', NULL, NULL, ?)`,
  )
    .bind(OTHER_EVENT_ID, NOW)
    .run()
  await env.DB.prepare(
    `INSERT INTO proposal_submissions
       (id, event_id, owner_contact_id, form_version_id, origin_draft_id, status,
        title, answers_json, content_hash, routing_json, created_at, submitted_at)
     VALUES ('submission-other', ?, ?, 'version-other', 'draft-other', 'pending',
             'Foreign proposal', '{}', ?, NULL, ?, ?)`,
  )
    .bind(OTHER_EVENT_ID, DEMO_CONF_2026_REVIEWER_ONE_ID, 'b'.repeat(64), NOW, NOW)
    .run()
  await env.DB.prepare(
    `INSERT INTO evaluation_rounds (event_id, id, number, name, status)
     VALUES (?, 'round-other', 1, 'Round 1', 'open')`,
  )
    .bind(OTHER_EVENT_ID)
    .run()
  await env.DB.prepare(
    `INSERT INTO evaluation_assignments
       (event_id, id, round_id, submission_id, evaluator_contact_id, created_at)
     VALUES (?, 'assignment-other', 'round-other', 'submission-other', ?, ?)`,
  )
    .bind(OTHER_EVENT_ID, DEMO_CONF_2026_REVIEWER_ONE_ID, NOW)
    .run()
}
