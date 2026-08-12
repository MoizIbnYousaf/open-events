import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_VERSION_ID } from '../../src/db'
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
 * Rounds an organizer can actually configure.
 *
 * A round could hold a number, a name and open/closed. Every round of an event
 * scored against ONE shared rubric, so a shortlisting pass and a final pass
 * could not ask different questions; and a criterion could only be a name with
 * a numeric weight, so a choice ("which track is this?") or prose ("what do we
 * tell the speaker?") had nowhere to live.
 *
 * These are the contracts for configuring a round, giving it its own
 * mixed-type scorecard, pooling reviewers into it, and — the part that decides
 * whether any of it is real — reading every bit of that back after a reload.
 */
beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

const ROUNDS_PATH = '/api/admin/events/demo-conf-2026/rounds'
const COMMITTEE_PATH = '/api/admin/events/demo-conf-2026/evaluations/committee'

interface RoundBody {
  readonly id: string
  readonly number: number
  readonly name: string
  readonly status: 'open' | 'closed'
  readonly opensAt: string | null
  readonly closesAt: string | null
  readonly anonymize: boolean
}

interface CriterionBody {
  readonly id: string
  readonly label: string
  readonly kind: 'rating' | 'select' | 'text'
  readonly weight: number | null
  readonly position: number
  readonly scale?: { readonly min: number; readonly max: number } | null
  readonly options?: readonly string[] | null
}

async function organizerCookie(): Promise<string> {
  return (await loginOrganizer()).token ?? ''
}

async function listRounds(cookie: string): Promise<readonly RoundBody[]> {
  const response = await app.request(
    ROUNDS_PATH,
    { headers: { cookie: cookieHeader(cookie) } },
    bindings(),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as readonly RoundBody[]
}

async function configureRound(
  cookie: string,
  roundId: string,
  body: Record<string, unknown>,
  origin = ALLOWED_ORIGIN,
): Promise<Response> {
  return app.request(
    `${ROUNDS_PATH}/${roundId}`,
    {
      method: 'PUT',
      headers: { cookie: cookieHeader(cookie), origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    bindings(),
  )
}

async function putScorecard(
  cookie: string,
  roundId: string,
  criteria: readonly Record<string, unknown>[],
  origin = ALLOWED_ORIGIN,
): Promise<Response> {
  return app.request(
    `${ROUNDS_PATH}/${roundId}/scorecard`,
    {
      method: 'PUT',
      headers: { cookie: cookieHeader(cookie), origin, 'content-type': 'application/json' },
      body: JSON.stringify({ criteria }),
    },
    bindings(),
  )
}

async function getScorecard(cookie: string, roundId: string): Promise<Response> {
  return app.request(
    `${ROUNDS_PATH}/${roundId}/scorecard`,
    { headers: { cookie: cookieHeader(cookie) } },
    bindings(),
  )
}

async function liveRoundId(cookie: string): Promise<string> {
  const rounds = await listRounds(cookie)
  const open = rounds.find((round) => round.status === 'open')
  return open?.id ?? rounds[0]?.id ?? ''
}

/** A submitted proposal assigned to a seated reviewer, and that reviewer's session. */
async function seedAssignedReviewer(
  organizer: string,
  email = 'round.reviewer@example.test',
): Promise<{ submissionId: string; reviewerCookie: string }> {
  const speaker = await submitterCookie(env.DB)
  const draftId = await savePublicDraft(speaker, {
    title: 'Taming 40-Minute CI',
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
        title: 'Taming 40-Minute CI',
        answers: SEEDED_TALK_ANSWERS,
        coSpeakers: [],
      }),
    },
    bindings(),
  )
  const submissionId = ((await submitted.json()) as { id: string }).id
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
  const raw = decodeURIComponent((message?.body ?? '').split('token=')[1] ?? '')
  const redeem = await app.request(
    `/api/public/session?token=${encodeURIComponent(raw)}`,
    undefined,
    bindings(),
  )
  const reviewerCookie = parseCookieToken(redeem.headers.get('set-cookie'))
  if (reviewerCookie === null) throw new Error('redeem set no session cookie')
  return { submissionId, reviewerCookie }
}

/** Opens a second round, since the seed ships exactly one. */
async function openSecondRound(cookie: string): Promise<string> {
  const response = await app.request(
    ROUNDS_PATH,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ number: 2, name: 'Round 2' }),
    },
    bindings(),
  )
  expect(response.status).toBe(200)
  return ((await response.json()) as { id: string }).id
}

describe('migration safety', () => {
  /**
   * The round table carries a trigger that forbids reopening a closed round.
   * Adding columns must not cost it — a DROP-and-recreate would take every
   * trigger and index with it while leaving the tests that never mention them
   * green, which is the exact failure migration 0015 recorded.
   */
  it('keeps the no-reopen trigger after the round columns are added', async () => {
    const trigger = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'evaluation_rounds_no_reopen'",
    ).first<{ name: string }>()

    expect(trigger?.name).toBe('evaluation_rounds_no_reopen')
  })

  it('still refuses to reopen a closed round', async () => {
    await env.DB.prepare(
      `INSERT INTO evaluation_rounds (event_id, id, number, name, status)
       SELECT id, 'round-closed-test', 9, 'Closed', 'closed' FROM events WHERE slug = 'demo-conf-2026'`,
    ).run()

    await expect(
      env.DB.prepare("UPDATE evaluation_rounds SET status = 'open' WHERE id = 'round-closed-test'")
        .run(),
    ).rejects.toThrow()
  })

  /** Seeded rounds predate the columns and must read as configured-with-nothing. */
  it('reads an existing round as undated and not anonymized', async () => {
    const organizer = await organizerCookie()

    const rounds = await listRounds(organizer)

    expect(rounds.length).toBeGreaterThan(0)
    for (const round of rounds) {
      expect(round.opensAt).toBeNull()
      expect(round.closesAt).toBeNull()
      expect(round.anonymize).toBe(false)
    }
  })
})

describe('an organizer configures a round', () => {
  it('renames it, dates it, and makes it blind — and it survives a reload', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    const response = await configureRound(organizer, roundId, {
      name: 'Shortlisting',
      opensAt: '2026-06-01T09:00:00.000Z',
      closesAt: '2026-06-14T17:00:00.000Z',
      anonymize: true,
    })

    expect(response.status).toBe(200)
    // Read back through a FRESH request, not the write's own response: a value
    // echoed by the handler proves nothing about what persisted.
    const reloaded = (await listRounds(organizer)).find((round) => round.id === roundId)
    expect(reloaded?.name).toBe('Shortlisting')
    expect(reloaded?.opensAt).toBe('2026-06-01T09:00:00.000Z')
    expect(reloaded?.closesAt).toBe('2026-06-14T17:00:00.000Z')
    expect(reloaded?.anonymize).toBe(true)
  })

  it('refuses a window that closes before it opens, and changes nothing', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)
    await configureRound(organizer, roundId, {
      name: 'Shortlisting',
      opensAt: '2026-06-01T09:00:00.000Z',
      closesAt: '2026-06-14T17:00:00.000Z',
    })

    const refused = await configureRound(organizer, roundId, {
      name: 'Shortlisting',
      opensAt: '2026-07-01T09:00:00.000Z',
      closesAt: '2026-06-01T09:00:00.000Z',
    })

    expect(refused.status).toBe(400)
    const reloaded = (await listRounds(organizer)).find((round) => round.id === roundId)
    expect(reloaded?.opensAt).toBe('2026-06-01T09:00:00.000Z')
    expect(reloaded?.closesAt).toBe('2026-06-14T17:00:00.000Z')
  })

  it('refuses an empty name', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    expect((await configureRound(organizer, roundId, { name: '   ' })).status).toBe(400)
  })

  it('is organizer-only and same-origin only', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    expect((await configureRound('', roundId, { name: 'Nope' })).status).toBe(401)
    expect(
      (await configureRound(organizer, roundId, { name: 'Nope' }, 'https://evil.test')).status,
    ).toBe(403)
  })

  it('cannot configure a round belonging to another event', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
       VALUES ('e0000000-0000-4000-8000-0000000009ff', 'other-conf-2026', 'Other', 'UTC',
               'draft', NULL, NULL)`,
    ).run()

    const response = await app.request(
      `/api/admin/events/other-conf-2026/rounds/${roundId}`,
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Stolen' }),
      },
      bindings(),
    )

    expect(response.status).toBe(404)
    expect((await listRounds(organizer)).find((round) => round.id === roundId)?.name).not.toBe(
      'Stolen',
    )
  })
})

describe('a round carries its own mixed-type scorecard', () => {
  const MIXED = [
    {
      label: 'Relevance',
      kind: 'rating',
      weight: 3,
      position: 0,
      scale: { min: 1, max: 5 },
    },
    {
      // No weight: a chosen option cannot be multiplied, so it carries none
      // rather than one the average would have to skip.
      label: 'Suggested track',
      kind: 'select',
      weight: null,
      position: 1,
      options: ['Platform & Infra', 'AI Engineering', 'Developer Experience'],
    },
    { label: 'Notes for the speaker', kind: 'text', weight: null, position: 2 },
  ]

  it('saves all three kinds and reloads them exactly', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    expect((await putScorecard(organizer, roundId, MIXED)).status).toBe(200)

    const response = await getScorecard(organizer, roundId)
    expect(response.status).toBe(200)
    const criteria = (await response.json()) as readonly CriterionBody[]
    expect(criteria.map((criterion) => criterion.label)).toEqual([
      'Relevance',
      'Suggested track',
      'Notes for the speaker',
    ])
    expect(criteria.map((criterion) => criterion.kind)).toEqual(['rating', 'select', 'text'])
    expect(criteria[0]?.weight).toBe(3)
    expect(criteria[0]?.scale).toEqual({ min: 1, max: 5 })
    expect(criteria[1]?.options).toEqual([
      'Platform & Infra',
      'AI Engineering',
      'Developer Experience',
    ])
    // Prose does not average, so it carries no weight rather than a weight the
    // arithmetic then has to remember to ignore.
    expect(criteria[2]?.weight).toBeNull()
  })

  it('keeps each round independent', async () => {
    const organizer = await organizerCookie()
    const first = await liveRoundId(organizer)
    const second = await openSecondRound(organizer)

    await putScorecard(organizer, first, MIXED)
    await putScorecard(organizer, second, [
      { label: 'Final call', kind: 'rating', weight: 5, position: 0, scale: { min: 1, max: 3 } },
    ])

    const firstCard = (await (await getScorecard(organizer, first)).json()) as readonly CriterionBody[]
    const secondCard = (await (await getScorecard(organizer, second)).json()) as readonly CriterionBody[]
    expect(firstCard.length).toBe(3)
    expect(secondCard.length).toBe(1)
    expect(secondCard[0]?.label).toBe('Final call')
    expect(secondCard[0]?.scale).toEqual({ min: 1, max: 3 })
  })

  it('replaces the scorecard wholesale rather than accumulating', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)
    await putScorecard(organizer, roundId, MIXED)

    await putScorecard(organizer, roundId, [
      { label: 'Only this', kind: 'rating', weight: 2, position: 0, scale: { min: 1, max: 5 } },
    ])

    const criteria = (await (await getScorecard(organizer, roundId)).json()) as readonly CriterionBody[]
    expect(criteria.map((criterion) => criterion.label)).toEqual(['Only this'])
  })

  it('refuses a select with no options and a rating with an inverted scale', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    expect(
      (await putScorecard(organizer, roundId, [
        { label: 'Empty choice', kind: 'select', weight: 1, position: 0, options: [] },
      ])).status,
    ).toBe(400)
    expect(
      (await putScorecard(organizer, roundId, [
        { label: 'Backwards', kind: 'rating', weight: 1, position: 0, scale: { min: 5, max: 1 } },
      ])).status,
    ).toBe(400)
  })

  it('refuses an unknown criterion kind rather than storing it', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    expect(
      (await putScorecard(organizer, roundId, [
        { label: 'Mystery', kind: 'telepathy', weight: 1, position: 0 },
      ])).status,
    ).toBe(400)
  })

  it('is organizer-only and same-origin only', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    expect((await putScorecard('', roundId, MIXED)).status).toBe(401)
    expect((await putScorecard(organizer, roundId, MIXED, 'https://evil.test')).status).toBe(403)
  })

  /**
   * A round with no scorecard of its own is not broken — it is every round that
   * existed before this feature. It falls back to the event rubric, so nothing
   * an organizer already configured stops working.
   */
  it('reports an empty scorecard for a round that has never had one', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    const response = await getScorecard(organizer, roundId)

    expect(response.status).toBe(200)
    expect((await response.json()) as readonly CriterionBody[]).toEqual([])
  })
})

/**
 * The half that makes a scorecard real.
 *
 * A round whose typed fields only the organizer can see is a configuration
 * screen, not a review process: the rubric requires those fields to render for
 * the REVIEWER, to store what they enter, to show it again when they come back,
 * and to feed an aggregate that respects the configured weights.
 */
describe('a reviewer scores against the round scorecard', () => {
  const SCORECARD = [
    { label: 'Relevance', kind: 'rating', weight: 3, position: 0, scale: { min: 1, max: 5 } },
    { label: 'Depth', kind: 'rating', weight: 1, position: 1, scale: { min: 1, max: 5 } },
    {
      label: 'Suggested track',
      kind: 'select',
      weight: null,
      position: 2,
      options: ['Platform & Infra', 'AI Engineering'],
    },
    { label: 'Notes for the speaker', kind: 'text', weight: null, position: 3 },
  ]

  interface QueueRow {
    readonly submissionId: string
    readonly criteria?: readonly {
      readonly id: string
      readonly label: string
      readonly kind: string
      readonly value: number | string | null
    }[]
  }

  async function setUp(): Promise<{
    organizer: string
    reviewer: string
    submissionId: string
    roundId: string
    criteria: readonly CriterionBody[]
  }> {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)
    await putScorecard(organizer, roundId, SCORECARD)
    const { submissionId, reviewerCookie: reviewer } = await seedAssignedReviewer(organizer)
    const criteria = (await (await getScorecard(organizer, roundId)).json()) as readonly CriterionBody[]
    return { organizer, reviewer, submissionId, roundId, criteria }
  }

  it('renders every configured field, with its type and its choices', async () => {
    const { reviewer } = await setUp()

    const response = await app.request(
      '/api/public/evaluations',
      { headers: { cookie: cookieHeader(reviewer) } },
      bindings(),
    )

    expect(response.status).toBe(200)
    const rows = (await response.json()) as readonly QueueRow[]
    const fields = rows[0]?.criteria ?? []
    expect(fields.map((field) => field.label)).toEqual([
      'Relevance',
      'Depth',
      'Suggested track',
      'Notes for the speaker',
    ])
    expect(fields.map((field) => field.kind)).toEqual(['rating', 'rating', 'select', 'text'])
    // Unanswered is null rather than absent, so a form can render an empty
    // field instead of guessing whether the question exists.
    expect(fields.every((field) => field.value === null)).toBe(true)
  })

  it('stores a number, a chosen option and prose, and shows them on return', async () => {
    const { reviewer, submissionId, criteria } = await setUp()
    const answers = [
      { criterionId: criteria[0]?.id, value: 5 },
      { criterionId: criteria[1]?.id, value: 2 },
      { criterionId: criteria[2]?.id, value: 'AI Engineering' },
      { criterionId: criteria[3]?.id, value: 'Tighten the middle third.' },
    ]

    const posted = await app.request(
      '/api/public/evaluations',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(reviewer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ submissionId, answers }),
      },
      bindings(),
    )
    expect(posted.status).toBe(200)

    // Reopened through a fresh read: every value comes back on its own field.
    const rows = (await (
      await app.request(
        '/api/public/evaluations',
        { headers: { cookie: cookieHeader(reviewer) } },
        bindings(),
      )
    ).json()) as readonly QueueRow[]
    const fields = rows[0]?.criteria ?? []
    expect(fields.map((field) => field.value)).toEqual([
      5,
      2,
      'AI Engineering',
      'Tighten the middle third.',
    ])
  })

  it('edits an answer rather than accumulating a second one', async () => {
    const { reviewer, submissionId, criteria } = await setUp()
    const post = (value: unknown) =>
      app.request(
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
            answers: [{ criterionId: criteria[0]?.id, value }],
          }),
        },
        bindings(),
      )

    await post(4)
    await post(2)

    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM evaluation_round_scores WHERE criterion_id = ?',
    )
      .bind(criteria[0]?.id ?? '')
      .first<{ n: number }>()
    expect(stored?.n).toBe(1)
  })

  it('refuses an option that is not on the list, and a rating off its scale', async () => {
    const { reviewer, submissionId, criteria } = await setUp()
    const post = (criterionId: string | undefined, value: unknown) =>
      app.request(
        '/api/public/evaluations',
        {
          method: 'POST',
          headers: {
            cookie: cookieHeader(reviewer),
            origin: ALLOWED_ORIGIN,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ submissionId, answers: [{ criterionId, value }] }),
        },
        bindings(),
      )

    expect((await post(criteria[2]?.id, 'Underwater Basket Weaving')).status).toBe(400)
    expect((await post(criteria[0]?.id, 9)).status).toBe(400)
  })

  /**
   * The number the organizer reads has to be the one their weights describe.
   * Relevance 5 at weight 3 and Depth 2 at weight 1 is (15 + 2) / 4 = 4.25 —
   * and the select and the free text take no part in it, because neither can
   * be multiplied.
   */
  it('aggregates the ratings by their configured weights and ignores the rest', async () => {
    const { organizer, reviewer, submissionId, criteria } = await setUp()
    await app.request(
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
          answers: [
            { criterionId: criteria[0]?.id, value: 5 },
            { criterionId: criteria[1]?.id, value: 2 },
            { criterionId: criteria[2]?.id, value: 'AI Engineering' },
            { criterionId: criteria[3]?.id, value: 'Tighten the middle third.' },
          ],
        }),
      },
      bindings(),
    )

    const summary = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    const body = (await summary.json()) as {
      readonly weightedAverageCentis: number
      readonly rounds: readonly { readonly weightedAverageCentis: number }[]
    }

    expect(body.weightedAverageCentis).toBe(425)
  })

  /** The organizer still reads the words, even though they are not averaged. */
  it('surfaces the chosen option and the prose to the organizer', async () => {
    const { organizer, reviewer, submissionId, criteria } = await setUp()
    await app.request(
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
          answers: [
            { criterionId: criteria[2]?.id, value: 'AI Engineering' },
            { criterionId: criteria[3]?.id, value: 'Tighten the middle third.' },
          ],
        }),
      },
      bindings(),
    )

    const summary = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    const rendered = JSON.stringify(await summary.json())
    expect(rendered).toContain('AI Engineering')
    expect(rendered).toContain('Tighten the middle third.')
  })

  /**
   * Backward compatibility, stated as a test rather than as a promise: a round
   * nobody has reconfigured keeps the single-rating path and the scores already
   * recorded against it.
   */
  it('leaves a round with no scorecard on the legacy single-rating path', async () => {
    const organizer = await organizerCookie()
    const { submissionId, reviewerCookie: reviewer } = await seedAssignedReviewer(organizer)

    const posted = await app.request(
      '/api/public/evaluations',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(reviewer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ submissionId, rating: 4, comments: 'Solid.' }),
      },
      bindings(),
    )

    expect(posted.status).toBe(200)
    const legacy = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM evaluation_scores WHERE rating = 4',
    ).first<{ n: number }>()
    expect(legacy?.n).toBe(1)
  })
})

describe('a round has its own reviewer pool', () => {
  const REVIEWER = 'pool.reviewer@example.test'

  async function seatReviewer(cookie: string): Promise<string> {
    const response = await app.request(
      COMMITTEE_PATH,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: REVIEWER }),
      },
      bindings(),
    )
    return ((await response.json()) as { contactId: string }).contactId
  }

  async function putPool(
    cookie: string,
    roundId: string,
    contactIds: readonly string[],
  ): Promise<Response> {
    return app.request(
      `${ROUNDS_PATH}/${roundId}/pool`,
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ contactIds }),
      },
      bindings(),
    )
  }

  async function getPool(cookie: string, roundId: string): Promise<readonly { contactId: string }[]> {
    const response = await app.request(
      `${ROUNDS_PATH}/${roundId}/pool`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(response.status).toBe(200)
    return (await response.json()) as readonly { contactId: string }[]
  }

  it('pools a seated reviewer into one round and reloads it', async () => {
    const organizer = await organizerCookie()
    const contactId = await seatReviewer(organizer)
    const roundId = await liveRoundId(organizer)

    expect((await putPool(organizer, roundId, [contactId])).status).toBe(200)

    expect((await getPool(organizer, roundId)).map((entry) => entry.contactId)).toEqual([contactId])
  })

  /**
   * The SEAT is the authority (established when removal was made to revoke
   * access). A pool is a narrowing of who reads this time, never a grant on its
   * own — so somebody who is not on the committee cannot be pooled into a round
   * as a way around it.
   */
  it('refuses to pool somebody who holds no committee seat', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    const response = await putPool(organizer, roundId, ['not-a-member-contact-id'])

    expect(response.status).toBe(400)
    expect(await getPool(organizer, roundId)).toEqual([])
  })

  it('drops a reviewer from every pool when their seat is taken away', async () => {
    const organizer = await organizerCookie()
    const contactId = await seatReviewer(organizer)
    const roundId = await liveRoundId(organizer)
    await putPool(organizer, roundId, [contactId])

    await app.request(
      `${COMMITTEE_PATH}/${contactId}`,
      {
        method: 'DELETE',
        headers: { cookie: cookieHeader(organizer), origin: ALLOWED_ORIGIN },
      },
      bindings(),
    )

    expect(await getPool(organizer, roundId)).toEqual([])
  })

  it('keeps pools independent between rounds', async () => {
    const organizer = await organizerCookie()
    const contactId = await seatReviewer(organizer)
    const first = await liveRoundId(organizer)
    const second = await openSecondRound(organizer)

    await putPool(organizer, first, [contactId])

    expect(await getPool(organizer, second)).toEqual([])
  })

  it('is organizer-only', async () => {
    const organizer = await organizerCookie()
    const roundId = await liveRoundId(organizer)

    expect((await putPool('', roundId, [])).status).toBe(401)
  })
})
