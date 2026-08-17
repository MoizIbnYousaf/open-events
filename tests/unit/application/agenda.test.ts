import { describe, expect, it } from 'vitest'

import {
  AgendaService,
  ApplicationError,
  type AgendaSessionRecord,
  type PlaceAgendaSessionInput,
} from '../../../src/application'
import type { Event } from '../../../src/domain'
import {
  EVENT_ID,
  EVENT_SLUG,
  NOW,
  createSubmission,
  createTaxonomyItem,
  eventFixture,
  organizerActor,
} from '../helpers/fixtures'
import {
  InMemoryAgendaRepository,
  InMemoryEventRepository,
  InMemoryFormVersionRepository,
  InMemorySubmissionRepository,
  InMemoryTaxonomyRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySpeakerTaskRepository } from '../helpers/in-memory-onboarding'

// Organizer agenda contract, exercised against the in-memory twins of the D1
// adapters: the board read, one placement with its explicit event predicate,
// deterministic positions and conflicts, and the publish that finally makes a
// session renderable on the public programme.

const OTHER_EVENT_ID = 'event-other'
const ROOM_MAIN = 'tax-room-main'
const ROOM_BREAKOUT = 'tax-room-breakout'
const TRACK_TALKS = 'tax-track-talks'
const DAY = '2026-05-13'
const START = '2026-05-13T09:00:00.000Z'
const END = '2026-05-13T10:00:00.000Z'
const PLACED_AT = '2026-05-16T10:00:00.000Z'

const otherEvent: Event = { ...eventFixture, id: OTHER_EVENT_ID, slug: 'other-conf' }

const taxonomy = [
  createTaxonomyItem({
    id: ROOM_MAIN,
    kind: 'room',
    key: 'main-hall',
    label: 'Main hall',
    position: 0,
  }),
  createTaxonomyItem({
    id: ROOM_BREAKOUT,
    kind: 'room',
    key: 'breakout',
    label: 'Breakout',
    position: 1,
  }),
  createTaxonomyItem({ id: TRACK_TALKS, kind: 'track', key: 'talks', label: 'Talks', position: 0 }),
  createTaxonomyItem({
    id: 'tax-format-talk',
    kind: 'format',
    key: 'talk',
    label: 'Talk',
    position: 0,
  }),
]

function unassignedSession(submissionId: string): AgendaSessionRecord {
  return {
    eventId: EVENT_ID,
    submissionId,
    trackId: null,
    roomId: null,
    day: '2026-05-13',
    start: '2026-05-13T08:00:00.000Z',
    end: '2026-05-13T09:00:00.000Z',
    position: null,
    status: 'draft',
    assignment: 'unassigned',
    speakerIds: ['contact-speaker-a'],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function placement(overrides: Partial<PlaceAgendaSessionInput> = {}): PlaceAgendaSessionInput {
  return { day: DAY, roomId: ROOM_MAIN, trackId: TRACK_TALKS, start: START, end: END, ...overrides }
}

function buildHarness(
  options: {
    readonly sessions?: readonly AgendaSessionRecord[]
    readonly accepted?: readonly string[]
    readonly submissionIds?: readonly string[]
    readonly dates?: Event['dates']
  } = {},
) {
  const submissionIds = options.submissionIds ?? ['submission-1']
  const versions = new InMemoryFormVersionRepository()
  const submissions = new InMemorySubmissionRepository(
    versions,
    submissionIds.map((id) => createSubmission({ id, title: `Proposal ${id}` })),
  )
  const event: Event =
    options.dates === undefined ? eventFixture : { ...eventFixture, dates: options.dates }
  const events = new InMemoryEventRepository([event, otherEvent])
  const taxonomies = new InMemoryTaxonomyRepository([[EVENT_ID, taxonomy]])
  const tasks = new InMemorySpeakerTaskRepository()
  for (const submissionId of options.accepted ?? submissionIds) {
    tasks.seedAcceptance({ eventId: EVENT_ID, submissionId, acceptedAt: NOW })
  }
  const agenda = new InMemoryAgendaRepository(
    options.sessions ?? submissionIds.map(unassignedSession),
  )
  const clock = { now: () => PLACED_AT }
  const service = new AgendaService(events, agenda, submissions, taxonomies, tasks, clock)
  return { service, agenda, tasks, submissions }
}

async function expectRejection(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(ApplicationError)
  await promise.catch((error: unknown) => {
    expect((error as ApplicationError).code).toBe(code)
  })
}

describe('agenda board read', () => {
  // The board lists a bounded number of days, so a long window reaches further
  // than the board draws. It says how far: a reader that only saw the days
  // would take the last of them for the end of the event and call a placement
  // beyond it one the window does not offer — which is the opposite of what
  // the server does with it.
  it('says how many days the window covers, not only the ones it lists', async () => {
    const { service } = buildHarness({
      dates: { startsAt: '2026-05-01T09:00:00.000Z', endsAt: '2026-06-01T17:00:00.000Z' },
    })

    const board = await service.getBoardBySlug(organizerActor, EVENT_SLUG)

    expect(board?.windowDays).toBe(32)
    expect(board?.days).toHaveLength(31)
    expect(board?.days.at(-1)?.day).toBe('2026-05-31')
    // And the day it stops short of is one it really takes a placement on.
    const placed = await service.place(
      organizerActor,
      EVENT_SLUG,
      'submission-1',
      placement({
        day: '2026-06-01',
        start: '2026-06-01T09:00:00.000Z',
        end: '2026-06-01T10:00:00.000Z',
      }),
    )
    expect(placed.sessions[0]?.assignment).toBe('scheduled')
  })

  it('reports a window it lists end to end as exactly as long as it is', async () => {
    const { service } = buildHarness()

    const board = await service.getBoardBySlug(organizerActor, EVENT_SLUG)

    expect(board?.windowDays).toBe(3)
    expect(board?.days).toHaveLength(3)
  })

  it('returns the accepted sessions, the committed vocabulary, and the event grid', async () => {
    const { service } = buildHarness()

    const board = await service.getBoardBySlug(organizerActor, EVENT_SLUG)

    expect(board?.eventId).toBe(EVENT_ID)
    // 2026-05-13T08:00 → 2026-05-15T17:00: each day offers the part of that
    // window falling on it. Only the first day opens at 08:00, the interior day
    // is covered end to end, and only the last day stops at 17:00.
    expect(board?.days.map((day) => day.day)).toEqual(['2026-05-13', '2026-05-14', '2026-05-15'])
    expect(board?.days[0]?.slots).toHaveLength(16)
    expect(board?.days[0]?.slots[0]).toEqual({ startTime: '08:00', endTime: '09:00' })
    expect(board?.days[1]?.slots).toHaveLength(24)
    expect(board?.days[1]?.slots[0]).toEqual({ startTime: '00:00', endTime: '01:00' })
    expect(board?.days[2]?.slots).toHaveLength(17)
    expect(board?.days[2]?.slots.at(-1)).toEqual({ startTime: '16:00', endTime: '17:00' })
    expect(board?.rooms.map((room) => room.key)).toEqual(['main-hall', 'breakout'])
    expect(board?.tracks.map((track) => track.key)).toEqual(['talks'])
    expect(board?.sessions).toEqual([
      {
        submissionId: 'submission-1',
        title: 'Proposal submission-1',
        source: 'cfp',
        day: '2026-05-13',
        start: '2026-05-13T08:00:00.000Z',
        end: '2026-05-13T09:00:00.000Z',
        roomId: null,
        roomLabel: null,
        trackId: null,
        trackLabel: null,
        position: null,
        status: 'draft',
        assignment: 'unassigned',
      },
    ])
  })

  it('leaves unplaced sessions out of the conflict set and the five views', async () => {
    const { service } = buildHarness({ submissionIds: ['submission-1', 'submission-2'] })

    const board = await service.getBoardBySlug(organizerActor, EVENT_SLUG)

    // Both share the placeholder slot acceptance gave them and one speaker,
    // but neither is placed, so neither is part of the programme yet.
    expect(board?.conflicts).toEqual([])
    expect(board?.views).toEqual({ list: [], day: {}, week: {}, track: {}, room: {} })
  })

  it('shows only submissions that carry an acceptance record', async () => {
    const { service } = buildHarness({
      submissionIds: ['submission-1', 'submission-2'],
      accepted: ['submission-1'],
    })

    const board = await service.getBoardBySlug(organizerActor, EVENT_SLUG)

    expect(board?.sessions.map((session) => session.submissionId)).toEqual(['submission-1'])
  })

  it('is null for an unknown slug', async () => {
    const { service } = buildHarness()

    expect(await service.getBoardBySlug(organizerActor, 'no-such-event')).toBeNull()
  })
})

describe('agenda placement', () => {
  it('places an accepted submission and derives the five views from the placement', async () => {
    const { service, agenda } = buildHarness()

    const board = await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())

    expect(board.sessions[0]).toMatchObject({
      roomId: ROOM_MAIN,
      roomLabel: 'Main hall',
      trackId: TRACK_TALKS,
      trackLabel: 'Talks',
      day: DAY,
      start: START,
      end: END,
      position: 0,
      assignment: 'scheduled',
      status: 'draft',
    })
    expect(board.views.list).toEqual(['submission-1'])
    expect(board.views.day).toEqual({ [DAY]: ['submission-1'] })
    expect(board.views.week).toEqual({ '2026-W20': ['submission-1'] })
    expect(board.views.track).toEqual({ [TRACK_TALKS]: ['submission-1'] })
    expect(board.views.room).toEqual({ [ROOM_MAIN]: ['submission-1'] })
    expect((await agenda.findBySubmission(EVENT_ID, 'submission-1'))?.updatedAt).toBe(PLACED_AT)
  })

  it('keeps the speakers the session already carried', async () => {
    const { service, agenda } = buildHarness()

    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())

    expect((await agenda.findBySubmission(EVENT_ID, 'submission-1'))?.speakerIds).toEqual([
      'contact-speaker-a',
    ])
  })

  it('gives each session in one room+slot its own position and reports the double booking', async () => {
    const { service } = buildHarness({ submissionIds: ['submission-1', 'submission-2'] })

    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    const board = await service.place(organizerActor, EVENT_SLUG, 'submission-2', placement())

    expect(board.sessions.map((session) => session.position)).toEqual([0, 1])
    expect(board.conflicts).toEqual([
      { kind: 'room', first: 'submission-1', second: 'submission-2' },
      { kind: 'speaker', first: 'submission-1', second: 'submission-2' },
    ])
  })

  it('is stable: re-placing a session into its own slot keeps its position', async () => {
    const { service } = buildHarness({ submissionIds: ['submission-1', 'submission-2'] })

    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    await service.place(organizerActor, EVENT_SLUG, 'submission-2', placement())
    const board = await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())

    expect(board.sessions.map((session) => session.position)).toEqual([0, 1])
  })

  it('reuses a freed position instead of colliding with the highest one', async () => {
    const { service } = buildHarness({
      submissionIds: ['submission-1', 'submission-2', 'submission-3'],
    })

    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    await service.place(organizerActor, EVENT_SLUG, 'submission-2', placement())
    await service.place(
      organizerActor,
      EVENT_SLUG,
      'submission-1',
      placement({ roomId: ROOM_BREAKOUT }),
    )
    const board = await service.place(organizerActor, EVENT_SLUG, 'submission-3', placement())

    const positions = new Map(
      board.sessions.map((session) => [session.submissionId, session.position]),
    )
    expect(positions.get('submission-2')).toBe(1)
    expect(positions.get('submission-3')).toBe(0)
  })

  it('rejects a submission that belongs to another event, whichever slug is used', async () => {
    const { service } = buildHarness()

    await expectRejection(
      service.place(organizerActor, 'other-conf', 'submission-1', placement()),
      'not_found',
    )
  })

  it('rejects a submission that was never accepted', async () => {
    const { service } = buildHarness({
      submissionIds: ['submission-1', 'submission-2'],
      accepted: ['submission-1'],
    })

    await expectRejection(
      service.place(organizerActor, EVENT_SLUG, 'submission-2', placement()),
      'not_found',
    )
  })

  it('rejects an unknown submission and an unknown event alike', async () => {
    const { service } = buildHarness()

    await expectRejection(
      service.place(organizerActor, EVENT_SLUG, 'guessed', placement()),
      'not_found',
    )
    await expectRejection(
      service.place(organizerActor, 'no-such-event', 'submission-1', placement()),
      'not_found',
    )
  })

  it('rejects vocabulary and slots the event does not offer', async () => {
    const { service, agenda } = buildHarness()

    await expectRejection(
      service.place(organizerActor, EVENT_SLUG, 'submission-1', placement({ roomId: TRACK_TALKS })),
      'validation_failed',
    )
    await expectRejection(
      service.place(organizerActor, EVENT_SLUG, 'submission-1', placement({ trackId: ROOM_MAIN })),
      'validation_failed',
    )
    await expectRejection(
      service.place(
        organizerActor,
        EVENT_SLUG,
        'submission-1',
        placement({ start: END, end: START }),
      ),
      'validation_failed',
    )
    await expectRejection(
      service.place(
        organizerActor,
        EVENT_SLUG,
        'submission-1',
        placement({ start: '13 May 09:00' }),
      ),
      'validation_failed',
    )
    await expectRejection(
      service.place(organizerActor, EVENT_SLUG, 'submission-1', placement({ day: '2026-05-14' })),
      'validation_failed',
    )
    await expectRejection(
      service.place(
        organizerActor,
        EVENT_SLUG,
        'submission-1',
        placement({
          day: '2026-06-01',
          start: '2026-06-01T09:00:00.000Z',
          end: '2026-06-01T10:00:00.000Z',
        }),
      ),
      'validation_failed',
    )
    expect((await agenda.findBySubmission(EVENT_ID, 'submission-1'))?.assignment).toBe('unassigned')
  })

  // The event runs 2026-05-13 08:00 → 2026-05-15 17:00. A day of that window is
  // not the same thing as an hour of it: before this, the placement was held to
  // the calendar dates alone, so the server took the small hours of the first
  // morning and the whole evening of the last day — hours the board never
  // offered — and the grid was the only thing keeping a placement inside the
  // window at all.
  it('rejects an hour outside the window even on a day the window covers', async () => {
    const { service, agenda } = buildHarness()

    await expectRejection(
      service.place(
        organizerActor,
        EVENT_SLUG,
        'submission-1',
        placement({
          day: '2026-05-13',
          start: '2026-05-13T07:00:00.000Z',
          end: '2026-05-13T08:00:00.000Z',
        }),
      ),
      'validation_failed',
    )
    await expectRejection(
      service.place(
        organizerActor,
        EVENT_SLUG,
        'submission-1',
        placement({
          day: '2026-05-15',
          start: '2026-05-15T17:00:00.000Z',
          end: '2026-05-15T18:00:00.000Z',
        }),
      ),
      'validation_failed',
    )
    expect((await agenda.findBySubmission(EVENT_ID, 'submission-1'))?.assignment).toBe('unassigned')
  })

  it('takes the hours at both edges of the window, which the board does offer', async () => {
    const { service, agenda } = buildHarness({ submissionIds: ['submission-1', 'submission-2'] })

    await service.place(
      organizerActor,
      EVENT_SLUG,
      'submission-1',
      placement({
        day: '2026-05-13',
        start: '2026-05-13T08:00:00.000Z',
        end: '2026-05-13T09:00:00.000Z',
      }),
    )
    await service.place(
      organizerActor,
      EVENT_SLUG,
      'submission-2',
      placement({
        day: '2026-05-15',
        start: '2026-05-15T16:00:00.000Z',
        end: '2026-05-15T17:00:00.000Z',
      }),
    )

    expect((await agenda.findBySubmission(EVENT_ID, 'submission-1'))?.assignment).toBe('scheduled')
    expect((await agenda.findBySubmission(EVENT_ID, 'submission-2'))?.assignment).toBe('scheduled')
  })

  it('rejects a slot whose end runs past the day the session starts on', async () => {
    const { service, agenda } = buildHarness()

    await expectRejection(
      service.place(
        organizerActor,
        EVENT_SLUG,
        'submission-1',
        placement({ end: '2030-01-01T00:00:00.000Z' }),
      ),
      'validation_failed',
    )

    expect((await agenda.findBySubmission(EVENT_ID, 'submission-1'))?.assignment).toBe('unassigned')
  })

  it('accepts the slot that closes the day at midnight', async () => {
    const { service } = buildHarness()

    const board = await service.place(
      organizerActor,
      EVENT_SLUG,
      'submission-1',
      placement({ start: '2026-05-13T23:00:00.000Z', end: '2026-05-14T00:00:00.000Z' }),
    )

    expect(board.sessions[0]).toMatchObject({
      start: '2026-05-13T23:00:00.000Z',
      end: '2026-05-14T00:00:00.000Z',
      assignment: 'scheduled',
    })
  })
})

describe('agenda retraction', () => {
  it('takes a published session off the programme and back into the unplaced pool', async () => {
    const { service, agenda } = buildHarness()
    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    await service.publish(organizerActor, EVENT_SLUG)

    const board = await service.unplace(organizerActor, EVENT_SLUG, 'submission-1')

    expect(board.sessions[0]).toMatchObject({
      status: 'draft',
      assignment: 'unassigned',
      roomId: null,
      roomLabel: null,
      position: null,
    })
    expect(board.views).toEqual({ list: [], day: {}, week: {}, track: {}, room: {} })
    expect(board.conflicts).toEqual([])
    const stored = await agenda.findBySubmission(EVENT_ID, 'submission-1')
    expect(stored).toMatchObject({ status: 'draft', assignment: 'unassigned', roomId: null })
    expect(stored?.updatedAt).toBe(PLACED_AT)
  })

  it('is durable: a later publish never puts the retracted session back', async () => {
    const { service } = buildHarness()
    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    await service.publish(organizerActor, EVENT_SLUG)
    await service.unplace(organizerActor, EVENT_SLUG, 'submission-1')

    expect((await service.publish(organizerActor, EVENT_SLUG)).publishedCount).toBe(0)
  })

  /**
   * Retraction must survive the rejection that makes it necessary.
   *
   * Placement is guarded against rejected talks, and unplace used to share that
   * guard — so the moment a published talk was rejected it became impossible to
   * take off the programme. Its row stayed `published` for good, hidden only by
   * the runtime filters on the board and the public schedule, and reinstating
   * the speaker later would have silently put a published session back in front
   * of the public with no organizer action.
   *
   * The guard belongs on the way IN. Removing something from the programme is
   * always allowed.
   */
  it('retracts a published session that has since been rejected', async () => {
    const { service, agenda, submissions } = buildHarness()
    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    await service.publish(organizerActor, EVENT_SLUG)
    await submissions.recordDecision({
      id: 'decision-1',
      eventId: EVENT_ID,
      submissionId: 'submission-1',
      outcome: 'rejected',
      decidedBy: 'organizer',
      decidedAt: NOW,
    })

    await service.unplace(organizerActor, EVENT_SLUG, 'submission-1')

    // Retracted in STORAGE, not merely filtered out of the read: a row left
    // 'published' would return to the public schedule the moment the rejection
    // was reversed.
    expect(await agenda.findBySubmission(EVENT_ID, 'submission-1')).toMatchObject({
      status: 'draft',
      assignment: 'unassigned',
      roomId: null,
    })
  })

  /** Placement stays guarded: the way in is where the verdict is enforced. */
  it('still refuses to place a rejected talk', async () => {
    const { service, submissions } = buildHarness()
    await submissions.recordDecision({
      id: 'decision-1',
      eventId: EVENT_ID,
      submissionId: 'submission-1',
      outcome: 'rejected',
      decidedBy: 'organizer',
      decidedAt: NOW,
    })

    await expectRejection(
      service.place(organizerActor, EVENT_SLUG, 'submission-1', placement()),
      'not_found',
    )
  })

  it('is idempotent for a session that is already unplaced', async () => {
    const { service } = buildHarness()

    const board = await service.unplace(organizerActor, EVENT_SLUG, 'submission-1')

    expect(board.sessions[0]).toMatchObject({ status: 'draft', assignment: 'unassigned' })
  })

  it('frees the position it held so another session can take it', async () => {
    const { service } = buildHarness({ submissionIds: ['submission-1', 'submission-2'] })
    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    await service.unplace(organizerActor, EVENT_SLUG, 'submission-1')

    const board = await service.place(organizerActor, EVENT_SLUG, 'submission-2', placement())

    const positions = new Map(
      board.sessions.map((session) => [session.submissionId, session.position]),
    )
    expect(positions.get('submission-2')).toBe(0)
  })

  it('never reaches another event, an unaccepted submission, or an unknown slug', async () => {
    const { service } = buildHarness({
      submissionIds: ['submission-1', 'submission-2'],
      accepted: ['submission-1'],
    })

    await expectRejection(
      service.unplace(organizerActor, 'other-conf', 'submission-1'),
      'not_found',
    )
    await expectRejection(service.unplace(organizerActor, EVENT_SLUG, 'submission-2'), 'not_found')
    await expectRejection(
      service.unplace(organizerActor, 'no-such-event', 'submission-1'),
      'not_found',
    )
    await expectRejection(service.unplace(organizerActor, EVENT_SLUG, 'guessed'), 'not_found')
  })
})

describe('agenda publish', () => {
  it('publishes the scheduled sessions and leaves the unplaced ones draft', async () => {
    const { service } = buildHarness({ submissionIds: ['submission-1', 'submission-2'] })
    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())

    const result = await service.publish(organizerActor, EVENT_SLUG)

    expect(result.publishedCount).toBe(1)
    const statuses = new Map(
      result.board.sessions.map((session) => [session.submissionId, session.status]),
    )
    expect(statuses.get('submission-1')).toBe('published')
    expect(statuses.get('submission-2')).toBe('draft')
  })

  it('is idempotent', async () => {
    const { service } = buildHarness()
    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    await service.publish(organizerActor, EVENT_SLUG)

    expect((await service.publish(organizerActor, EVENT_SLUG)).publishedCount).toBe(0)
  })

  it('keeps a published session published when it is moved', async () => {
    const { service } = buildHarness()
    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())
    await service.publish(organizerActor, EVENT_SLUG)

    const board = await service.place(
      organizerActor,
      EVENT_SLUG,
      'submission-1',
      placement({ roomId: ROOM_BREAKOUT }),
    )

    expect(board.sessions[0]).toMatchObject({ status: 'published', roomId: ROOM_BREAKOUT })
  })

  it('never reaches another event and rejects an unknown slug', async () => {
    const { service } = buildHarness()
    await service.place(organizerActor, EVENT_SLUG, 'submission-1', placement())

    expect((await service.publish(organizerActor, 'other-conf')).publishedCount).toBe(0)
    await expectRejection(service.publish(organizerActor, 'no-such-event'), 'not_found')
  })
})
