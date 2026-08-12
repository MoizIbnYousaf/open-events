import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { SEEDED_TALK_ANSWERS, applyMigrations, seedDemoConf } from './m2b-helpers'
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
 * The results table: every proposal the committee has read, with what it scored.
 *
 * Weighted criteria were configurable and their output was reachable only one
 * submission at a time, so the one question a programme committee actually meets
 * to answer — which proposals came out on top — had no screen. An organizer could
 * read a score by opening a proposal and remembering it, which is not a ranking.
 *
 * This is the read behind that screen: one row per submission, the aggregate the
 * per-submission summary already computes, and enough of the proposal to
 * recognise it. Sorting is the client's job — the rows carry a comparable number
 * so the table can order by it in both directions.
 */
beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

const RESULTS_PATH = '/api/admin/events/demo-conf-2026/results'

async function organizerCookie(): Promise<string> {
  const session = await loginOrganizer()
  expect(session.token).not.toBeNull()
  return session.token ?? ''
}

async function getResults(cookie: string, path = RESULTS_PATH): Promise<Response> {
  return app.request(path, { headers: { cookie: cookieHeader(cookie) } }, bindings())
}

/** A submitted proposal owned by a fresh speaker; returns its id. */
async function submitProposal(title: string): Promise<string> {
  // Lowercased: identities are normalised on capture, so a mixed-case address
  // would be stored lower and never match the lookup.
  const email = `${title.replace(/\W+/g, '.').toLowerCase()}@example.test`
  const cookie = await submitterCookie(env.DB, {}, email)
  const draftId = await savePublicDraft(cookie, { title, answers: SEEDED_TALK_ANSWERS })
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
  return ((await response.json()) as { id: string }).id
}

type ResultRow = {
  readonly submissionId: string
  readonly title: string
  readonly weightedAverageCentis: number | null
  readonly scoredCount: number
  readonly assignmentCount: number
  readonly decision: string | null
  readonly contributors: readonly { readonly name: string; readonly role: string }[]
}

describe('the organizer can read every proposal’s result in one place', () => {
  it('returns one row per submission with the aggregate already computed', async () => {
    const first = await submitProposal('Taming 40-Minute CI')
    const second = await submitProposal('Your AI Pair Programmer')
    const organizer = await organizerCookie()

    const response = await getResults(organizer)
    expect(response.status).toBe(200)
    const rows = (await response.json()) as readonly ResultRow[]
    expect(rows.map((row) => row.submissionId).sort()).toEqual([first, second].sort())
    for (const row of rows) {
      expect(row.title).toBeTypeOf('string')
      // The aggregate is a NUMBER the caller can order by, or null when nobody
      // has scored it — never a string a table would sort lexically.
      expect(
        row.weightedAverageCentis === null || typeof row.weightedAverageCentis === 'number',
      ).toBe(true)
      expect(row.assignmentCount).toBeTypeOf('number')
      expect(row.scoredCount).toBeTypeOf('number')
    }
  })

  it('reports an unscored proposal as unscored rather than as zero', async () => {
    await submitProposal('Nobody has read this yet')
    const organizer = await organizerCookie()
    const rows = (await (await getResults(organizer)).json()) as readonly ResultRow[]
    const row = rows[0]
    expect(row).toBeDefined()
    // Zero is a score a reviewer can give. "Not yet reviewed" is not a score, and
    // conflating them would rank an unread proposal below a badly-reviewed one.
    expect(row?.weightedAverageCentis).toBeNull()
    expect(row?.scoredCount).toBe(0)
  })

  it('carries the decision so the table can show what was decided', async () => {
    const submissionId = await submitProposal('Decided proposal')
    const organizer = await organizerCookie()
    await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/decision`,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ decision: 'accepted' }),
      },
      bindings(),
    )
    const rows = (await (await getResults(organizer)).json()) as readonly ResultRow[]
    expect(rows.find((row) => row.submissionId === submissionId)?.decision).toBe('accepted')
  })

  it('names the people on each proposal, with their roles', async () => {
    await submitProposal('Taming 40-Minute CI')
    const organizer = await organizerCookie()
    const rows = (await (await getResults(organizer)).json()) as readonly ResultRow[]
    const contributors = rows[0]?.contributors ?? []
    expect(contributors.length).toBeGreaterThan(0)
    // A co-author is only visible if the role travels with the name.
    expect(contributors[0]?.role).toBeTypeOf('string')
    expect(contributors[0]?.name).toBeTypeOf('string')
  })

  it('is organizer-only and refuses an anonymous caller', async () => {
    await submitProposal('Guarded')
    const speaker = await submitterCookie(env.DB)
    expect((await getResults(speaker)).status).toBe(403)
    expect((await app.request(RESULTS_PATH, undefined, bindings())).status).toBe(401)
  })

  it('never leaks another event’s proposals', async () => {
    await submitProposal('This event only')
    const organizer = await organizerCookie()
    // An unknown event is a safe 404, and the known event returns only its own.
    expect((await getResults(organizer, '/api/admin/events/no-such-event/results')).status).toBe(
      404,
    )
    const rows = (await (await getResults(organizer)).json()) as readonly ResultRow[]
    expect(rows.every((row) => row.title === 'This event only')).toBe(true)
  })
})
