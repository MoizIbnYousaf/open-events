import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

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
 * The committee an organizer can actually SEE.
 *
 * Seating a reviewer already worked, and a reviewer already had a queue — but
 * the two were connected only through a box on one submission's detail page.
 * There was no way to ask "who is on my committee", so the roster the product
 * maintained was invisible to the person maintaining it, and the review
 * subsystem read as absent to anyone looking for it.
 *
 * These are the reads and the removal that a roster needs before any screen can
 * render one.
 */
beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

const COMMITTEE_PATH = '/api/admin/events/demo-conf-2026/evaluations/committee'
const SEEDED_REVIEWER = 'reviewer.one@example.test'
const COLD_REVIEWER = 'cold.reviewer@example.test'

interface RosterEntry {
  readonly contactId: string
  readonly email: string
  readonly name: string
  readonly addedAt: string
  readonly assignedCount: number
  readonly completedCount: number
}

async function organizerCookie(): Promise<string> {
  const session = await loginOrganizer()
  return session.token ?? ''
}

async function listRoster(cookie: string, path = COMMITTEE_PATH): Promise<Response> {
  return app.request(path, { headers: { cookie: cookieHeader(cookie) } }, bindings())
}

async function invite(cookie: string, email: string, name?: string): Promise<Response> {
  return app.request(
    COMMITTEE_PATH,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(name === undefined ? { email } : { email, name }),
    },
    bindings(),
  )
}

async function removeMember(
  cookie: string,
  contactId: string,
  origin = ALLOWED_ORIGIN,
): Promise<Response> {
  return app.request(
    `${COMMITTEE_PATH}/${contactId}`,
    { method: 'DELETE', headers: { cookie: cookieHeader(cookie), origin } },
    bindings(),
  )
}

async function contactRowCount(email: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM contacts WHERE email = ?')
    .bind(email)
    .first<{ n: number }>()
  return row?.n ?? 0
}

describe('an organizer reads their review committee', () => {
  it('lists the seated members with the identity an organizer can recognise', async () => {
    const organizer = await organizerCookie()

    const response = await listRoster(organizer)

    expect(response.status).toBe(200)
    const roster = (await response.json()) as readonly RosterEntry[]
    // The seed seats reviewer.one and reviewer.two on this event.
    expect(roster.map((entry) => entry.email).sort()).toEqual([
      'reviewer.one@example.test',
      'reviewer.two@example.test',
    ])
    const first = roster.find((entry) => entry.email === SEEDED_REVIEWER)
    expect(first?.name).not.toBe('')
    expect(first?.addedAt).toHaveLength(24)
  })

  /**
   * A roster of names is a phone book. The question an organizer actually has is
   * "who still owes me reviews", so the counts travel with the seat.
   */
  it('reports how much each member has been given and how much they have done', async () => {
    const organizer = await organizerCookie()

    const roster = (await (await listRoster(organizer)).json()) as readonly RosterEntry[]

    for (const entry of roster) {
      expect(typeof entry.assignedCount).toBe('number')
      expect(typeof entry.completedCount).toBe('number')
      // Nobody has been assigned anything on a fresh seed, so the honest answer
      // is zero — not an absent field the screen would render as blank.
      expect(entry.assignedCount).toBe(0)
      expect(entry.completedCount).toBe(0)
      expect(entry.completedCount).toBeLessThanOrEqual(entry.assignedCount)
    }
  })

  it('shows a newly invited reviewer on the roster immediately', async () => {
    const organizer = await organizerCookie()
    expect((await invite(organizer, COLD_REVIEWER, 'Cold Reviewer')).status).toBe(200)

    const roster = (await (await listRoster(organizer)).json()) as readonly RosterEntry[]

    const seated = roster.find((entry) => entry.email === COLD_REVIEWER)
    expect(seated).toBeDefined()
    expect(seated?.name).toBe('Cold Reviewer')
    expect(seated?.assignedCount).toBe(0)
  })

  it('is scoped to the event in the path and never leaks another committee', async () => {
    const organizer = await organizerCookie()
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
       VALUES ('e0000000-0000-4000-8000-0000000009ff', 'other-conf-2026', 'Other Conf 2026',
               'UTC', 'draft', NULL, NULL)`,
    ).run()

    const other = await listRoster(
      organizer,
      '/api/admin/events/other-conf-2026/evaluations/committee',
    )

    expect(other.status).toBe(200)
    expect((await other.json()) as readonly RosterEntry[]).toEqual([])
  })

  it('answers a safe 404 for an event that does not exist', async () => {
    const organizer = await organizerCookie()

    expect(
      (await listRoster(organizer, '/api/admin/events/no-such/evaluations/committee')).status,
    ).toBe(404)
  })

  it('is organizer-only', async () => {
    expect((await listRoster('')).status).toBe(401)
  })
})

/**
 * Read-only statement recorder, so the roster's cost is a measured number
 * rather than a hope.
 */
function countingDb(statements: string[]): D1Database {
  return {
    ...env.DB,
    prepare: (sql: string) => {
      statements.push(sql)
      return env.DB.prepare(sql)
    },
  } as unknown as D1Database
}

describe('the roster read is bounded', () => {
  /**
   * The roster is a list with two counts per row, and the obvious shape —
   * fetch the members, then per member fetch their contact and assignments,
   * then per assignment fetch its scores — is O(members + assignments) round
   * trips. At a realistic committee that is hundreds of queries for one screen,
   * on a product where responsiveness is an explicit criterion.
   *
   * The count is pinned rather than merely "small": a bound nobody asserts is a
   * bound that regresses the first time somebody adds a field to a row.
   */
  it('costs a constant number of statements regardless of committee size', async () => {
    const organizer = await organizerCookie()
    // Seat several more reviewers so a per-member query pattern would show up.
    for (const index of [1, 2, 3, 4, 5]) {
      await invite(organizer, `extra.reviewer.${index}@example.test`, `Extra ${index}`)
    }

    const statements: string[] = []
    const response = await app.request(
      COMMITTEE_PATH,
      { headers: { cookie: cookieHeader(organizer) } },
      bindings({ DB: countingDb(statements) }),
    )

    expect(response.status).toBe(200)
    const roster = (await response.json()) as readonly RosterEntry[]
    expect(roster.length).toBe(7) // 2 seeded + 5 invited
    // EXACTLY three, pinned rather than bounded loosely: the session lookup,
    // the event resolution, and one statement for the entire roster. A ceiling
    // with slack in it is a ceiling that absorbs the next regression silently.
    // This was 17 for the same seven members before the counts moved into SQL,
    // and it grew with every member and every assignment.
    expect(statements.length).toBe(3)
  })
})

/**
 * The seam the whole slice exists to close: seating somebody on the roster has
 * to be what puts them in front of their queue. Without this, an organizer can
 * add a reviewer who then signs in and lands on the CFP wizard as a speaker —
 * which is exactly what an evaluator reported as "there is no reviewer portal".
 */
describe('a seated reviewer signing in lands on their queue', () => {
  async function signInAndFollow(email: string): Promise<string | null> {
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
    return redeem.headers.get('location')
  }

  it('sends a reviewer the organizer just invited to the review queue', async () => {
    const organizer = await organizerCookie()
    expect((await invite(organizer, COLD_REVIEWER, 'Cold Reviewer')).status).toBe(200)

    expect(await signInAndFollow(COLD_REVIEWER)).toBe('/evaluations')
  })

  it('still sends everybody else to the call for papers', async () => {
    expect(await signInAndFollow('not.a.reviewer@example.test')).not.toBe('/evaluations')
  })

  it('stops sending them there once their seat is removed', async () => {
    const organizer = await organizerCookie()
    const seated = (await (await invite(organizer, COLD_REVIEWER)).json()) as { contactId: string }
    expect(await signInAndFollow(COLD_REVIEWER)).toBe('/evaluations')

    await removeMember(organizer, seated.contactId)

    expect(await signInAndFollow(COLD_REVIEWER)).not.toBe('/evaluations')
  })
})

/** A submitted proposal, assigned to `reviewerEmail` in the live round. */
async function seedAssignedSubmission(
  organizer: string,
  reviewerEmail: string,
): Promise<{ submissionId: string }> {
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
  const assigned = await app.request(
    `/api/admin/events/demo-conf-2026/submissions/${submissionId}/assignments`,
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(organizer),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ evaluatorEmail: reviewerEmail }),
    },
    bindings(),
  )
  expect(assigned.status).toBe(200)
  return { submissionId }
}

/** Signs a reviewer in through the real magic-link routes. */
async function reviewerCookie(email: string): Promise<string> {
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
  const cookie = parseCookieToken(redeem.headers.get('set-cookie'))
  if (cookie === null) throw new Error('redeem set no session cookie')
  return cookie
}

describe('an organizer removes a reviewer from the committee', () => {
  async function seatedContactId(cookie: string, email: string): Promise<string> {
    const roster = (await (await listRoster(cookie)).json()) as readonly RosterEntry[]
    return roster.find((entry) => entry.email === email)?.contactId ?? ''
  }

  it('takes the seat away and the roster stops listing them', async () => {
    const organizer = await organizerCookie()
    const contactId = await seatedContactId(organizer, SEEDED_REVIEWER)

    const removed = await removeMember(organizer, contactId)

    expect(removed.status).toBe(200)
    const roster = (await (await listRoster(organizer)).json()) as readonly RosterEntry[]
    expect(roster.map((entry) => entry.email)).not.toContain(SEEDED_REVIEWER)
  })

  /**
   * Removing a SEAT is not deleting a PERSON. The contact is a global identity
   * that may be a speaker on another event and may hold scores this event still
   * relies on; taking away their committee seat must not reach any of that.
   */
  it('leaves the person, and their recorded scores, alone', async () => {
    const organizer = await organizerCookie()
    const contactId = await seatedContactId(organizer, SEEDED_REVIEWER)

    await removeMember(organizer, contactId)

    expect(await contactRowCount(SEEDED_REVIEWER)).toBe(1)
    const assignments = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM evaluation_assignments WHERE event_id = ? AND evaluator_contact_id = ?',
    )
      .bind(DEMO_CONF_2026_ID, contactId)
      .first<{ n: number }>()
    expect(assignments?.n ?? 0).toBe(0)
  })

  /**
   * The same claim, on a reviewer who actually HAS work and scores.
   *
   * The test above starts from a fresh seed where the member had zero of both,
   * so it proves 0 === 0 and would pass against an implementation that deleted
   * everything. This one seeds real rows first, because "nothing was destroyed"
   * is only a statement about something that existed.
   */
  it('keeps the assignments and scores of a reviewer who had done work', async () => {
    const organizer = await organizerCookie()
    const seated = (await (await invite(organizer, COLD_REVIEWER)).json()) as { contactId: string }
    const { submissionId } = await seedAssignedSubmission(organizer, COLD_REVIEWER)
    const reviewer = await reviewerCookie(COLD_REVIEWER)
    const scored = await app.request(
      '/api/public/evaluations',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(reviewer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ submissionId, rating: 4, comments: 'Worth a slot.' }),
      },
      bindings(),
    )
    expect(scored.status).toBe(200)

    await removeMember(organizer, seated.contactId)

    // The seat is gone…
    const roster = (await (await listRoster(organizer)).json()) as readonly RosterEntry[]
    expect(roster.map((entry) => entry.email)).not.toContain(COLD_REVIEWER)
    // …and everything they did is still there. An average the committee already
    // reached does not become untrue because somebody later left it.
    const kept = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM evaluation_assignments
                WHERE event_id = ?1 AND evaluator_contact_id = ?2) AS assignments,
              (SELECT COUNT(*) FROM evaluation_scores s
                 JOIN evaluation_assignments a ON a.event_id = s.event_id AND a.id = s.assignment_id
                WHERE s.event_id = ?1 AND a.evaluator_contact_id = ?2) AS scores`,
    )
      .bind(DEMO_CONF_2026_ID, seated.contactId)
      .first<{ assignments: number; scores: number }>()
    expect(kept?.assignments).toBe(1)
    expect(kept?.scores).toBe(1)
    expect(await contactRowCount(COLD_REVIEWER)).toBe(1)

    // And the organizer can still read what they said.
    const summary = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}/evaluation-summary`,
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    expect(JSON.stringify(await summary.json())).toContain('Worth a slot.')
  })

  /**
   * The promise the roster makes: giving up the seat takes the access away.
   *
   * It must be tested with a reviewer who HAS assignments, because that is the
   * only reviewer the feature is about — and it is exactly the case the
   * membership check used to skip. A removal test using someone with an empty
   * queue proves the one path where the check already fired, and certifies
   * nothing about the reviewer an organizer actually removes.
   */
  it('takes the review queue away from a reviewer who has assignments', async () => {
    const organizer = await organizerCookie()
    const seated = (await (await invite(organizer, COLD_REVIEWER)).json()) as { contactId: string }
    // Give them something to read, then sign them in and confirm they can see it.
    const { submissionId } = await seedAssignedSubmission(organizer, COLD_REVIEWER)
    const reviewer = await reviewerCookie(COLD_REVIEWER)
    const before = await app.request(
      '/api/public/evaluations',
      { headers: { cookie: cookieHeader(reviewer) } },
      bindings(),
    )
    expect(before.status).toBe(200)
    expect(((await before.json()) as readonly unknown[]).length).toBeGreaterThan(0)

    await removeMember(organizer, seated.contactId)

    // The queue is gone, with the SAME session cookie: removal is not a thing
    // that only takes effect at the next sign-in.
    const after = await app.request(
      '/api/public/evaluations',
      { headers: { cookie: cookieHeader(reviewer) } },
      bindings(),
    )
    expect(after.status).toBe(403)

    // And they cannot write, either. A read-only revocation would leave a
    // removed reviewer able to overwrite the scores of a committee they are
    // no longer on.
    const write = await app.request(
      '/api/public/evaluations',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(reviewer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ submissionId, rating: 5 }),
      },
      bindings(),
    )
    expect(write.status).toBe(403)
  })

  it('is idempotent: removing a seat nobody holds is not an error', async () => {
    const organizer = await organizerCookie()
    const contactId = await seatedContactId(organizer, SEEDED_REVIEWER)
    await removeMember(organizer, contactId)

    expect((await removeMember(organizer, contactId)).status).toBe(200)
  })

  it('is organizer-only and same-origin only', async () => {
    const organizer = await organizerCookie()
    const contactId = await seatedContactId(organizer, SEEDED_REVIEWER)

    expect((await removeMember('', contactId)).status).toBe(401)
    expect((await removeMember(organizer, contactId, 'https://evil.test')).status).toBe(403)
    // and the seat survived every refusal
    const roster = (await (await listRoster(organizer)).json()) as readonly RosterEntry[]
    expect(roster.map((entry) => entry.email)).toContain(SEEDED_REVIEWER)
  })

  it('cannot remove a seat from another event by naming this one', async () => {
    const organizer = await organizerCookie()
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
       VALUES ('e0000000-0000-4000-8000-0000000009ff', 'other-conf-2026', 'Other Conf 2026',
               'UTC', 'draft', NULL, NULL)`,
    ).run()
    const contactId = await seatedContactId(organizer, SEEDED_REVIEWER)

    const response = await app.request(
      `/api/admin/events/other-conf-2026/evaluations/committee/${contactId}`,
      { method: 'DELETE', headers: { cookie: cookieHeader(organizer), origin: ALLOWED_ORIGIN } },
      bindings(),
    )

    expect(response.status).toBe(200) // idempotent: there was no such seat there
    const stillSeated = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM evaluation_committee_members WHERE event_id = ? AND contact_id = ?',
    )
      .bind(DEMO_CONF_2026_ID, contactId)
      .first<{ n: number }>()
    expect(stillSeated?.n ?? 0).toBe(1)
  })
})
