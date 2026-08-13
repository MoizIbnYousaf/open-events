import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
import app from '../../src/server'
import { DEMO_CONF_2026_ID } from '../../src/db'
import {
  SEEDED_WORKSHOP_ANSWERS,
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

// Admin agenda API contract: the organizer reads the placeable board (accepted
// submissions, their placements, the committed room/track/day vocabulary and
// the deterministic conflict set), places one accepted submission, and
// publishes the scheduled sessions so the public schedule renders them. Every
// route runs through the real application with real sessions, the real CSRF
// gate, and an explicit event predicate derived from the slug.

const EVENT_SLUG = 'demo-conf-2026'
const AGENDA_PATH = `/api/admin/events/${EVENT_SLUG}/agenda`
const PUBLISH_PATH = `${AGENDA_PATH}/publish`
const SCHEDULE_PATH = `/api/public/events/${EVENT_SLUG}/schedule`
const OTHER_EVENT_ID = 'b2f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3e'
const OTHER_EVENT_SLUG = 'other-conf-2026'
const ROOM_MAIN_HALL = 'f0000000-0000-4000-8000-000000000505'
const ROOM_WORKSHOP_A = 'f0000000-0000-4000-8000-000000000506'
const TRACK_TALK = 'f0000000-0000-4000-8000-000000000504'
/** The track the seeded proposal answers, and therefore the one it arrives with. */
const TRACK_PLATFORM_INFRA = 'f0000000-0000-4000-8000-000000000503'
const FORMAT_TALK = 'f0000000-0000-4000-8000-000000000502'
const DAY = '2026-05-13'
const START = '2026-05-13T09:00:00.000Z'
const END = '2026-05-13T10:00:00.000Z'

interface BoardSession {
  readonly submissionId: string
  readonly title: string
  readonly day: string
  readonly start: string
  readonly end: string
  readonly roomId: string | null
  readonly roomLabel: string | null
  readonly trackId: string | null
  readonly trackLabel: string | null
  readonly position: number | null
  readonly status: string
  readonly assignment: string
}

interface BoardOption {
  readonly id: string
  readonly key: string
  readonly label: string
}

interface Board {
  readonly eventId: string
  readonly slug: string
  readonly timezone: string
  readonly days: ReadonlyArray<{
    readonly day: string
    readonly slots: ReadonlyArray<{ readonly startTime: string; readonly endTime: string }>
  }>
  readonly rooms: readonly BoardOption[]
  readonly tracks: readonly BoardOption[]
  readonly sessions: readonly BoardSession[]
  readonly conflicts: ReadonlyArray<{
    readonly kind: string
    readonly first: string
    readonly second: string
  }>
  readonly views: {
    readonly list: readonly string[]
    readonly day: Readonly<Record<string, readonly string[]>>
    readonly week: Readonly<Record<string, readonly string[]>>
    readonly track: Readonly<Record<string, readonly string[]>>
    readonly room: Readonly<Record<string, readonly string[]>>
  }
}

let organizerToken: string
let speakerCookie: string
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
        formVersionId: 'f0000000-0000-4000-8000-000000000002',
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

async function acceptSubmission(id: string): Promise<void> {
  const response = await app.request(
    `/api/admin/events/demo-conf-2026/submissions/${id}/accept`,
    {
      method: 'POST',
      headers: { cookie: cookieHeader(organizerToken), origin: ALLOWED_ORIGIN },
    },
    bindings(),
  )
  if (response.status !== 200) throw new Error(`accept failed with ${response.status}`)
}

async function organizerRequest(
  method: string,
  path: string,
  body?: unknown,
  overrides: { readonly cookie?: string; readonly origin?: string } = {},
): Promise<Response> {
  return await app.request(
    path,
    {
      method,
      headers: {
        cookie: cookieHeader(overrides.cookie ?? organizerToken),
        origin: overrides.origin ?? ALLOWED_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  )
}

async function readBoard(path = AGENDA_PATH): Promise<Board> {
  const response = await organizerRequest('GET', path)
  if (response.status !== 200) throw new Error(`agenda read failed with ${response.status}`)
  return (await response.json()) as Board
}

function placement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    day: DAY,
    roomId: ROOM_MAIN_HALL,
    trackId: TRACK_TALK,
    start: START,
    end: END,
    ...overrides,
  }
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
  // A second event with no agenda of its own: the organizer session carries no
  // event id, so every agenda route has to derive the event from the slug.
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
     VALUES (?, ?, 'Other conference', 'Europe/Berlin', 'draft', ?, ?)`,
  )
    .bind(OTHER_EVENT_ID, OTHER_EVENT_SLUG, '2026-09-01T08:00:00.000Z', '2026-09-01T17:00:00.000Z')
    .run()
  const login = await loginOrganizer()
  if (login.token === null) throw new Error('organizer login set no cookie')
  organizerToken = login.token
  speakerCookie = await submitterCookie(env.DB)
  submissionId = await submitProposal(speakerCookie, 'Workshop proposal')
  await acceptSubmission(submissionId)
})

describe('GET /api/admin/events/:slug/agenda', () => {
  it('returns the accepted submissions, the committed vocabulary, and an empty conflict set', async () => {
    const response = await organizerRequest('GET', AGENDA_PATH)
    expect(response.status).toBe(200)
    const board = (await response.json()) as Board

    expect(board.eventId).toBe(DEMO_CONF_2026_ID)
    expect(board.slug).toBe(EVENT_SLUG)
    expect(board.timezone).toBe('Europe/Berlin')
    expect(board.days.map((day) => day.day)).toEqual(['2026-05-13', '2026-05-14', '2026-05-15'])
    expect(board.days[0]?.slots[0]).toEqual({ startTime: '08:00', endTime: '09:00' })
    // The event's own last day is the only one its 17:00 close bounds.
    expect(board.days[0]?.slots.at(-1)).toEqual({ startTime: '23:00', endTime: '00:00' })
    expect(board.days[2]?.slots.at(-1)).toEqual({ startTime: '16:00', endTime: '17:00' })
    expect(board.rooms.map((room) => room.key)).toEqual(['main-hall', 'workshop-a'])
    expect(board.tracks.map((track) => track.key)).toEqual([
      'platform-infra',
      'ai-engineering',
      'developer-experience',
    ])
    expect(board.sessions).toHaveLength(1)
    expect(board.sessions[0]).toMatchObject({
      submissionId,
      title: 'Workshop proposal',
      roomId: null,
      // The submitter answered the track question, so acceptance carries that
      // answer onto the session. It used to arrive null, which published a
      // blank track column and left the track filter nothing to filter.
      trackId: TRACK_PLATFORM_INFRA,
      status: 'draft',
      assignment: 'unassigned',
    })
    expect(board.conflicts).toEqual([])
  })

  it('never exposes speaker contact ids or emails on the board', async () => {
    const rendered = JSON.stringify(await readBoard())

    expect(rendered).not.toContain('speaker-a@example.test')
    expect(rendered).not.toContain('contactId')
    expect(rendered).not.toContain('speakerIds')
  })

  it('scopes the board to the event named by the slug', async () => {
    const other = await readBoard(`/api/admin/events/${OTHER_EVENT_SLUG}/agenda`)

    expect(other.eventId).toBe(OTHER_EVENT_ID)
    expect(other.sessions).toEqual([])
  })

  it('requires an organizer session and a known event', async () => {
    expect((await app.request(AGENDA_PATH, undefined, bindings())).status).toBe(401)
    expect(
      (await organizerRequest('GET', AGENDA_PATH, undefined, { cookie: speakerCookie })).status,
    ).toBe(403)
    expect((await organizerRequest('GET', '/api/admin/events/no-such-event/agenda')).status).toBe(
      404,
    )
  })
})

describe('PUT /api/admin/events/:slug/agenda/:submissionId', () => {
  it('places an accepted submission and returns the updated board', async () => {
    const response = await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())
    expect(response.status).toBe(200)
    const board = (await response.json()) as Board

    expect(board.sessions[0]).toMatchObject({
      submissionId,
      day: DAY,
      start: START,
      end: END,
      roomId: ROOM_MAIN_HALL,
      roomLabel: 'Main hall',
      trackId: TRACK_TALK,
      trackLabel: 'AI Engineering',
      position: 0,
      status: 'draft',
      assignment: 'scheduled',
    })
    expect(board.views.list).toEqual([submissionId])
    expect(board.views.day).toEqual({ [DAY]: [submissionId] })
    expect(board.views.week).toEqual({ '2026-W20': [submissionId] })
    expect(board.views.track).toEqual({ [TRACK_TALK]: [submissionId] })
    expect(board.views.room).toEqual({ [ROOM_MAIN_HALL]: [submissionId] })
  })

  it('keeps the placement after a re-read', async () => {
    await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())

    const board = await readBoard()
    expect(board.sessions[0]).toMatchObject({ roomId: ROOM_MAIN_HALL, assignment: 'scheduled' })
  })

  it('reports the room double booking it just created', async () => {
    const second = await submitProposal(speakerCookie, 'Second proposal')
    await acceptSubmission(second)
    await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())
    const response = await organizerRequest('PUT', `${AGENDA_PATH}/${second}`, placement())
    expect(response.status).toBe(200)
    const board = (await response.json()) as Board

    // Both proposals belong to the same speaker, so one slot in one room is
    // both a room double booking and a speaker clash.
    const ordered = [submissionId, second].sort()
    expect(board.conflicts).toEqual([
      { kind: 'room', first: ordered[0], second: ordered[1] },
      { kind: 'speaker', first: ordered[0], second: ordered[1] },
    ])
    expect(board.sessions.map((session) => session.position)).toEqual([0, 1])
  })

  it('rejects a cross-origin placement before it reaches the database', async () => {
    const response = await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement(), {
      origin: 'http://evil.test',
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } })
    expect((await readBoard()).sessions[0]?.assignment).toBe('unassigned')
  })

  it('rejects a submission that belongs to another event', async () => {
    const response = await organizerRequest(
      'PUT',
      `/api/admin/events/${OTHER_EVENT_SLUG}/agenda/${submissionId}`,
      placement(),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
    expect((await readBoard()).sessions[0]?.assignment).toBe('unassigned')
  })

  it('rejects a submission that has not been accepted', async () => {
    const pending = await submitProposal(speakerCookie, 'Not accepted yet')

    const response = await organizerRequest('PUT', `${AGENDA_PATH}/${pending}`, placement())
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('rejects an unknown submission and an unknown event with the same envelope', async () => {
    expect((await organizerRequest('PUT', `${AGENDA_PATH}/guessed-id`, placement())).status).toBe(
      404,
    )
    expect(
      (await organizerRequest('PUT', `/api/admin/events/nope/agenda/${submissionId}`, placement()))
        .status,
    ).toBe(404)
  })

  it('rejects a room that is not a room of this event, and an unparsable slot', async () => {
    const notARoom = await organizerRequest(
      'PUT',
      `${AGENDA_PATH}/${submissionId}`,
      placement({ roomId: FORMAT_TALK }),
    )
    expect(notARoom.status).toBe(400)
    expect(await notARoom.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })

    const backwards = await organizerRequest(
      'PUT',
      `${AGENDA_PATH}/${submissionId}`,
      placement({ start: END, end: START }),
    )
    expect(backwards.status).toBe(400)

    const dayMismatch = await organizerRequest(
      'PUT',
      `${AGENDA_PATH}/${submissionId}`,
      placement({ day: '2026-05-14' }),
    )
    expect(dayMismatch.status).toBe(400)

    const outsideEvent = await organizerRequest(
      'PUT',
      `${AGENDA_PATH}/${submissionId}`,
      placement({
        day: '2026-06-01',
        start: '2026-06-01T09:00:00.000Z',
        end: '2026-06-01T10:00:00.000Z',
      }),
    )
    expect(outsideEvent.status).toBe(400)

    expect((await readBoard()).sessions[0]?.assignment).toBe('unassigned')
  })

  it('rejects a slot whose end runs past the day the session starts on', async () => {
    const response = await organizerRequest(
      'PUT',
      `${AGENDA_PATH}/${submissionId}`,
      placement({ end: '2030-01-01T00:00:00.000Z' }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })
    expect((await readBoard()).sessions[0]?.assignment).toBe('unassigned')
  })

  it('requires an organizer session', async () => {
    expect(
      (
        await app.request(
          `${AGENDA_PATH}/${submissionId}`,
          {
            method: 'PUT',
            headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
            body: JSON.stringify(placement()),
          },
          bindings(),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement(), {
          cookie: speakerCookie,
        })
      ).status,
    ).toBe(403)
  })
})

/**
 * Assisted placement, end to end.
 *
 * The value is not a fuller board — it is that everything on it is something
 * the organizer could have dragged there. A board with a double-booked speaker
 * has to be audited before it can be trusted, which is more work than placing
 * the sessions by hand would have been.
 */
describe('POST /api/admin/events/:slug/agenda/auto-place', () => {
  const AUTO_PLACE_PATH = `${AGENDA_PATH}/auto-place`

  it('schedules the unplaced sessions and reports what it did', async () => {
    const second = await submitProposal(speakerCookie, 'Also unplaced')
    await acceptSubmission(second)

    const response = await organizerRequest('POST', AUTO_PLACE_PATH)

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      placedCount: number
      remainingCount: number
      board: Board
    }
    expect(body.placedCount).toBeGreaterThan(0)
    const placed = body.board.sessions.filter((session) => session.roomId !== null)
    expect(placed.length).toBe(body.placedCount)
  })

  it('never places a session into a conflict', async () => {
    const second = await submitProposal(speakerCookie, 'Also unplaced')
    await acceptSubmission(second)

    await organizerRequest('POST', AUTO_PLACE_PATH)
    const board = await readBoard()

    // The board's OWN conflict rule, asked after the run: an assisted
    // placement that produces work for the organizer has not helped them.
    expect(board.conflicts).toEqual([])
  })

  it('leaves what an organizer already placed exactly where it is', async () => {
    await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())
    const second = await submitProposal(speakerCookie, 'Also unplaced')
    await acceptSubmission(second)

    await organizerRequest('POST', AUTO_PLACE_PATH)
    const board = await readBoard()

    const byId = new Map(board.sessions.map((session) => [session.submissionId, session]))
    expect(byId.get(submissionId)?.roomId).toBe(ROOM_MAIN_HALL)
    expect(byId.get(submissionId)?.start).toBe(START)
  })

  it('is refused without an organizer session', async () => {
    // 403 rather than 401: the CSRF gate runs before the session check on every
    // admin POST, so a request with no same-origin header never reaches it.
    const response = await app.request(AUTO_PLACE_PATH, { method: 'POST' }, bindings())
    expect(response.status).toBe(403)
  })
})

describe('POST /api/admin/events/:slug/agenda/publish', () => {
  it('publishes the scheduled sessions and leaves the unplaced ones alone', async () => {
    const unplaced = await submitProposal(speakerCookie, 'Still unplaced')
    await acceptSubmission(unplaced)
    await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())

    const response = await organizerRequest('POST', PUBLISH_PATH)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { publishedCount: number; board: Board }

    expect(body.publishedCount).toBe(1)
    const byId = new Map(body.board.sessions.map((session) => [session.submissionId, session]))
    expect(byId.get(submissionId)?.status).toBe('published')
    expect(byId.get(unplaced)?.status).toBe('draft')
  })

  it('is idempotent: publishing twice publishes nothing the second time', async () => {
    await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())
    await organizerRequest('POST', PUBLISH_PATH)

    const again = await organizerRequest('POST', PUBLISH_PATH)
    expect(again.status).toBe(200)
    expect(((await again.json()) as { publishedCount: number }).publishedCount).toBe(0)
  })

  it('never publishes another event’s agenda', async () => {
    await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())

    const response = await organizerRequest(
      'POST',
      `/api/admin/events/${OTHER_EVENT_SLUG}/agenda/publish`,
    )
    expect(response.status).toBe(200)
    expect(((await response.json()) as { publishedCount: number }).publishedCount).toBe(0)
    expect((await readBoard()).sessions[0]?.status).toBe('draft')
  })

  it('requires an organizer session and a same-origin request', async () => {
    expect(
      (
        await app.request(
          PUBLISH_PATH,
          { method: 'POST', headers: { origin: ALLOWED_ORIGIN } },
          bindings(),
        )
      ).status,
    ).toBe(401)
    expect(
      (await organizerRequest('POST', PUBLISH_PATH, undefined, { cookie: speakerCookie })).status,
    ).toBe(403)
    expect(
      (await organizerRequest('POST', PUBLISH_PATH, undefined, { origin: 'http://evil.test' }))
        .status,
    ).toBe(403)
  })
})

describe('DELETE /api/admin/events/:slug/agenda/:submissionId', () => {
  async function publicSessions(): Promise<readonly unknown[]> {
    const response = await app.request(SCHEDULE_PATH, undefined, bindings())
    return ((await response.json()) as { sessions: readonly unknown[] }).sessions
  }

  it('takes a published session back off the public programme', async () => {
    await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())
    await organizerRequest('POST', PUBLISH_PATH)
    expect(await publicSessions()).toHaveLength(1)

    const response = await organizerRequest('DELETE', `${AGENDA_PATH}/${submissionId}`)
    expect(response.status).toBe(200)
    const board = (await response.json()) as Board

    expect(board.sessions[0]).toMatchObject({
      submissionId,
      status: 'draft',
      assignment: 'unassigned',
      roomId: null,
      position: null,
    })
    expect(board.views.list).toEqual([])
    expect(await publicSessions()).toEqual([])
  })

  it('leaves the retraction in place across a re-read and a later publish', async () => {
    await organizerRequest('PUT', `${AGENDA_PATH}/${submissionId}`, placement())
    await organizerRequest('POST', PUBLISH_PATH)
    await organizerRequest('DELETE', `${AGENDA_PATH}/${submissionId}`)

    const again = await organizerRequest('POST', PUBLISH_PATH)
    expect(((await again.json()) as { publishedCount: number }).publishedCount).toBe(0)
    expect((await readBoard()).sessions[0]?.status).toBe('draft')
    expect(await publicSessions()).toEqual([])
  })

  it('rejects a submission that belongs to another event', async () => {
    const response = await organizerRequest(
      'DELETE',
      `/api/admin/events/${OTHER_EVENT_SLUG}/agenda/${submissionId}`,
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('requires an organizer session and a same-origin request', async () => {
    expect(
      (
        await app.request(
          `${AGENDA_PATH}/${submissionId}`,
          { method: 'DELETE', headers: { origin: ALLOWED_ORIGIN } },
          bindings(),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await organizerRequest('DELETE', `${AGENDA_PATH}/${submissionId}`, undefined, {
          cookie: speakerCookie,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await organizerRequest('DELETE', `${AGENDA_PATH}/${submissionId}`, undefined, {
          origin: 'http://evil.test',
        })
      ).status,
    ).toBe(403)
  })
})

describe('placement and publish reach the public schedule', () => {
  it('renders the placed, published session on the public programme', async () => {
    const before = await app.request(SCHEDULE_PATH, undefined, bindings())
    expect(((await before.json()) as { sessions: unknown[] }).sessions).toEqual([])

    await organizerRequest(
      'PUT',
      `${AGENDA_PATH}/${submissionId}`,
      placement({ roomId: ROOM_WORKSHOP_A }),
    )
    await organizerRequest('POST', PUBLISH_PATH)

    const after = await app.request(SCHEDULE_PATH, undefined, bindings())
    expect(after.status).toBe(200)
    const body = (await after.json()) as {
      timezone: string
      sessions: ReadonlyArray<Record<string, unknown>>
    }
    expect(body.sessions).toEqual([
      {
        submissionId,
        title: 'Workshop proposal',
        track: 'AI Engineering',
        room: 'Workshop A',
        day: DAY,
        start: START,
        end: END,
        position: 0,
      },
    ])
  })
})
