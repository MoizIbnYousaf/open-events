import { describe, expect, it } from 'vitest'

import {
  buildAgendaAggregates,
  buildAgendaGrid,
  deriveReq014Views,
  findAgendaConflicts,
  gridSlotInstants,
  isPlaceableSlot,
  latestAgendaEnd,
  placeSessions,
  transitionAgendaStatus,
  transitionSessionAssignment,
  type AgendaGridSlot,
} from '../../../src/domain/agenda'

// Agenda domain contract: placement, deterministic room/speaker/track
// conflicts, the five aggregate projections powering agenda views, and valid
// agenda state transitions.
// Fixtures reference ONLY committed vocabulary: TaxonomyItem ids
// (src/domain/taxonomy.ts — kind 'track'/'room'), ProposalSubmission ids and
// contributor contact ids (src/domain/submission.ts), Event ids and UTC
// instants (src/domain/event.ts), and the agenda session's own day/status.

const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'

const TRACK_TALKS = 'tax-track-talks'
const TRACK_WORKSHOPS = 'tax-track-workshops'
const ROOM_MAIN = 'tax-room-main'
const ROOM_BREAKOUT = 'tax-room-breakout'

interface AgendaSessionInput {
  readonly submissionId: string
  readonly eventId: string
  readonly trackId: string | null
  readonly roomId: string | null
  readonly day: string
  readonly start: string
  readonly end: string
  readonly status: 'draft' | 'published'
  readonly speakerIds: readonly string[]
}

interface AgendaPlacementInput {
  readonly sessions: readonly AgendaSessionInput[]
  readonly rooms: readonly string[]
  readonly tracks: readonly string[]
}

// These local shapes keep the fixtures explicit while exercising the domain
// functions with realistic event, room, track, and speaker identifiers.
interface AgendaPlacement {
  readonly submissionId: string
  readonly eventId: string
  readonly trackId: string
  readonly roomId: string
  readonly day: string
  readonly start: string
  readonly end: string
  readonly position: number
  readonly speakerIds: readonly string[]
}

interface AgendaConflict {
  readonly kind: 'room' | 'speaker' | 'track'
  readonly first: string
  readonly second: string
}

const SESSION_A: AgendaSessionInput = {
  submissionId: 'submission-a',
  eventId: EVENT_ID,
  trackId: TRACK_TALKS,
  roomId: ROOM_MAIN,
  day: '2026-05-13',
  start: '2026-05-13T09:00:00.000Z',
  end: '2026-05-13T10:00:00.000Z',
  status: 'published',
  speakerIds: ['contact-1'],
}

const SESSION_B: AgendaSessionInput = {
  submissionId: 'submission-b',
  eventId: EVENT_ID,
  trackId: TRACK_TALKS,
  roomId: ROOM_MAIN,
  day: '2026-05-13',
  start: '2026-05-13T10:00:00.000Z',
  end: '2026-05-13T11:00:00.000Z',
  status: 'published',
  speakerIds: ['contact-2'],
}

const SESSION_C: AgendaSessionInput = {
  submissionId: 'submission-c',
  eventId: EVENT_ID,
  trackId: TRACK_WORKSHOPS,
  roomId: ROOM_BREAKOUT,
  day: '2026-05-20',
  start: '2026-05-20T09:00:00.000Z',
  end: '2026-05-20T12:00:00.000Z',
  status: 'draft',
  speakerIds: ['contact-3'],
}

const PLACEMENT_INPUT: AgendaPlacementInput = {
  sessions: [SESSION_A, SESSION_B, SESSION_C],
  rooms: [ROOM_MAIN, ROOM_BREAKOUT],
  tracks: [TRACK_TALKS, TRACK_WORKSHOPS],
}

describe('agenda placement', () => {
  it('assigns every session a room, track, slot, and explicit position', () => {
    const placements: readonly AgendaPlacement[] = placeSessions(PLACEMENT_INPUT)

    expect(placements).toHaveLength(3)
    expect(placements.map((placement) => placement.submissionId)).toEqual([
      'submission-a',
      'submission-b',
      'submission-c',
    ])
    for (const placement of placements) {
      expect(placement.eventId).toBe(EVENT_ID)
      expect(placement.trackId).toBeTruthy()
      expect(placement.roomId).toBeTruthy()
      expect(placement.day).toBeTruthy()
      expect(placement.start).toBeTruthy()
      expect(placement.end).toBeTruthy()
      expect(placement.position).toBeGreaterThanOrEqual(0)
    }
  })

  it('is deterministic: identical inputs produce the identical placement sequence', () => {
    expect(placeSessions(PLACEMENT_INPUT)).toEqual(placeSessions(PLACEMENT_INPUT))
  })

  it('scopes position per room+slot: the first session in each combination starts at 0', () => {
    const sameSlotInput: AgendaPlacementInput = {
      sessions: [SESSION_A, { ...SESSION_B, start: SESSION_A.start, end: SESSION_A.end }],
      rooms: [ROOM_MAIN, ROOM_BREAKOUT],
      tracks: [TRACK_TALKS, TRACK_WORKSHOPS],
    }
    const placements: readonly AgendaPlacement[] = placeSessions(sameSlotInput)

    expect(placements.map((placement) => placement.position)).toEqual([0, 1])
    expect(
      placeSessions(PLACEMENT_INPUT).map((placement: AgendaPlacement) => placement.position),
    ).toEqual([0, 0, 0])
  })
})

describe('agenda conflict detection', () => {
  it('detects room, speaker, and track conflicts deterministically (same inputs → same conflict set)', () => {
    const conflictPlacements: readonly AgendaPlacement[] = placeSessions({
      sessions: [
        SESSION_A,
        { ...SESSION_B, start: SESSION_A.start, end: '2026-05-13T10:30:00.000Z' },
        {
          ...SESSION_C,
          submissionId: 'submission-e',
          roomId: ROOM_BREAKOUT,
          speakerIds: ['contact-1'],
          start: SESSION_A.start,
          end: '2026-05-13T10:30:00.000Z',
          day: SESSION_A.day,
        },
        {
          ...SESSION_C,
          submissionId: 'submission-f',
          trackId: TRACK_TALKS,
          speakerIds: ['contact-4'],
          start: SESSION_A.start,
          end: '2026-05-13T10:30:00.000Z',
          day: SESSION_A.day,
        },
      ],
      rooms: [ROOM_MAIN, ROOM_BREAKOUT],
      tracks: [TRACK_TALKS, TRACK_WORKSHOPS],
    })

    const first = findAgendaConflicts(conflictPlacements)
    const second = findAgendaConflicts(conflictPlacements)
    expect(first).toEqual(second)
    // submission-e and submission-f share ROOM_BREAKOUT on the identical slot,
    // and submission-b and submission-f share TRACK_TALKS across two rooms on
    // that same slot: an identical slot is the strongest overlap there is, so
    // both pairs are reported.
    expect(first).toEqual([
      { kind: 'room', first: 'submission-a', second: 'submission-b' },
      { kind: 'room', first: 'submission-e', second: 'submission-f' },
      { kind: 'speaker', first: 'submission-a', second: 'submission-e' },
      { kind: 'track', first: 'submission-a', second: 'submission-f' },
      { kind: 'track', first: 'submission-b', second: 'submission-f' },
    ])
  })

  it('reports the identical-slot double booking of one room as a room conflict', () => {
    const doubleBooked: readonly AgendaPlacement[] = placeSessions({
      sessions: [SESSION_A, { ...SESSION_B, start: SESSION_A.start, end: SESSION_A.end }],
      rooms: [ROOM_MAIN, ROOM_BREAKOUT],
      tracks: [TRACK_TALKS, TRACK_WORKSHOPS],
    })

    // Both sessions sit in ROOM_MAIN for exactly 09:00–10:00 on 2026-05-13.
    // The position model can store the pair (positions 0 and 1), but for the
    // organizer it is the plainest double booking and must be reported.
    expect(doubleBooked.map((placement) => placement.position)).toEqual([0, 1])
    expect(findAgendaConflicts(doubleBooked)).toEqual([
      { kind: 'room', first: 'submission-a', second: 'submission-b' },
    ])
  })

  it('reports an overlap that runs across midnight, whatever day the rows carry', () => {
    const acrossMidnight: readonly AgendaPlacement[] = placeSessions({
      sessions: [
        {
          ...SESSION_A,
          submissionId: 'submission-late',
          day: '2026-05-13',
          start: '2026-05-13T22:00:00.000Z',
          end: '2026-05-14T02:00:00.000Z',
        },
        {
          ...SESSION_B,
          submissionId: 'submission-early',
          day: '2026-05-14',
          start: '2026-05-14T01:00:00.000Z',
          end: '2026-05-14T02:00:00.000Z',
          speakerIds: SESSION_A.speakerIds,
        },
        {
          ...SESSION_B,
          submissionId: 'submission-later',
          day: '2026-05-14',
          start: '2026-05-14T03:00:00.000Z',
          end: '2026-05-14T04:00:00.000Z',
        },
      ],
      rooms: [ROOM_MAIN, ROOM_BREAKOUT],
      tracks: [TRACK_TALKS, TRACK_WORKSHOPS],
    })

    // The late session holds ROOM_MAIN from 22:00 into the next morning, so the
    // 01:00 session in that room is a real double booking even though the two
    // rows carry different days. The 03:00 session starts after it ends and is
    // left alone: overlap is a property of the instants, not of the day column.
    expect(findAgendaConflicts(acrossMidnight)).toEqual([
      { kind: 'room', first: 'submission-early', second: 'submission-late' },
      { kind: 'speaker', first: 'submission-early', second: 'submission-late' },
    ])
  })

  it('never treats a missing room or track identifier as a shared room or track', () => {
    const unplaced: readonly AgendaPlacement[] = placeSessions({
      sessions: [
        { ...SESSION_A, roomId: null, trackId: null },
        { ...SESSION_B, roomId: null, trackId: null, start: SESSION_A.start, end: SESSION_A.end },
      ],
      rooms: [],
      tracks: [],
    })

    expect(unplaced.map((placement) => placement.roomId)).toEqual(['', ''])
    expect(unplaced.map((placement) => placement.trackId)).toEqual(['', ''])
    expect(findAgendaConflicts(unplaced)).toEqual([])
  })

  it('still reports a shared speaker across two sessions without a room', () => {
    const unplaced: readonly AgendaPlacement[] = placeSessions({
      sessions: [
        { ...SESSION_A, roomId: null, trackId: null },
        {
          ...SESSION_B,
          roomId: null,
          trackId: null,
          speakerIds: SESSION_A.speakerIds,
          start: SESSION_A.start,
          end: SESSION_A.end,
        },
      ],
      rooms: [],
      tracks: [],
    })

    expect(findAgendaConflicts(unplaced)).toEqual([
      { kind: 'speaker', first: 'submission-a', second: 'submission-b' },
    ])
  })

  it('returns a sorted, stable conflict set', () => {
    const conflictPlacements: readonly AgendaPlacement[] = placeSessions({
      sessions: [
        SESSION_A,
        { ...SESSION_B, start: SESSION_A.start, end: '2026-05-13T10:30:00.000Z' },
      ],
      rooms: [ROOM_MAIN, ROOM_BREAKOUT],
      tracks: [TRACK_TALKS, TRACK_WORKSHOPS],
    })
    const conflicts: readonly AgendaConflict[] = findAgendaConflicts(conflictPlacements)

    for (const conflict of conflicts) {
      expect(conflict.first < conflict.second).toBe(true)
    }
    const kinds = conflicts.map((conflict) => conflict.kind)
    expect(kinds).toEqual([...kinds].sort())
    expect(findAgendaConflicts(conflictPlacements)).toEqual(conflicts)
  })
})

describe('agenda aggregate projections', () => {
  it('per-track aggregate groups sessions by track taxonomy item', () => {
    const aggregates = buildAgendaAggregates(placeSessions(PLACEMENT_INPUT))

    expect(aggregates.perTrack).toEqual({
      [TRACK_TALKS]: ['submission-a', 'submission-b'],
      [TRACK_WORKSHOPS]: ['submission-c'],
    })
  })

  it('per-room aggregate groups sessions by room taxonomy item', () => {
    const aggregates = buildAgendaAggregates(placeSessions(PLACEMENT_INPUT))

    expect(aggregates.perRoom).toEqual({
      [ROOM_MAIN]: ['submission-a', 'submission-b'],
      [ROOM_BREAKOUT]: ['submission-c'],
    })
  })

  it('per-day aggregate groups sessions by event day', () => {
    const aggregates = buildAgendaAggregates(placeSessions(PLACEMENT_INPUT))

    expect(aggregates.perDay).toEqual({
      '2026-05-13': ['submission-a', 'submission-b'],
      '2026-05-20': ['submission-c'],
    })
  })

  it('per-time-slot aggregate groups sessions by day+start+end', () => {
    const aggregates = buildAgendaAggregates(placeSessions(PLACEMENT_INPUT))

    expect(aggregates.perTimeSlot).toEqual({
      '2026-05-13|2026-05-13T09:00:00.000Z|2026-05-13T10:00:00.000Z': ['submission-a'],
      '2026-05-13|2026-05-13T10:00:00.000Z|2026-05-13T11:00:00.000Z': ['submission-b'],
      '2026-05-20|2026-05-20T09:00:00.000Z|2026-05-20T12:00:00.000Z': ['submission-c'],
    })
  })

  it('per-status aggregate groups sessions by agenda status (draft/published)', () => {
    const aggregates = buildAgendaAggregates(placeSessions(PLACEMENT_INPUT))

    expect(aggregates.perStatus).toEqual({
      published: ['submission-a', 'submission-b'],
      draft: ['submission-c'],
    })
  })
})

describe('agenda view derivation', () => {
  it('derives the five user-facing views from the aggregates (list, day, week, track, room)', () => {
    const aggregates = buildAgendaAggregates(placeSessions(PLACEMENT_INPUT))
    const views = deriveReq014Views(aggregates)

    // Explicit mapping: list = perTimeSlot flattened in (day, start) order,
    // day = perDay, week = perDay bucketed by ISO week, track = perTrack,
    // room = perRoom.
    expect(views.list).toEqual(['submission-a', 'submission-b', 'submission-c'])
    expect(views.day).toEqual(aggregates.perDay)
    expect(views.week).toEqual({
      '2026-W20': ['submission-a', 'submission-b'],
      '2026-W21': ['submission-c'],
    })
    expect(views.track).toEqual(aggregates.perTrack)
    expect(views.room).toEqual(aggregates.perRoom)
  })
})

// The grid the organizer places into. The rule under test: each day offers the
// part of the event's own window that falls on it. Only the first day opens at
// the event's start time — every later day has had the window running since the
// midnight that opened it — and only the last day closes at the event's end
// time, every earlier one closing at the midnight that ends it. So an interior
// day, covered end to end, offers the whole day, and neither edge of the window
// caps the days it does not touch.
describe('agenda grid derivation', () => {
  /** Whole-hour start times from `from` up to but excluding `to`. */
  function hoursFrom(from: number, to: number): readonly string[] {
    return Array.from(
      { length: to - from },
      (_, step) => `${String(from + step).padStart(2, '0')}:00`,
    )
  }

  const WORKING_DAY_FROM_09 = [
    '09:00',
    '10:00',
    '11:00',
    '12:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
    '18:00',
    '19:00',
    '20:00',
    '21:00',
    '22:00',
    '23:00',
  ] as const

  function startTimes(slots: readonly AgendaGridSlot[]): readonly string[] {
    return slots.map((slot) => slot.startTime)
  }

  it('offers no day at all when the event has no dates, or a window that ends before it starts', () => {
    expect(buildAgendaGrid(null)).toEqual({ days: [], windowDays: 0 })
    expect(
      buildAgendaGrid({ startsAt: '2026-05-15T09:00:00.000Z', endsAt: '2026-05-13T09:00:00.000Z' }),
    ).toEqual({ days: [], windowDays: 0 })
  })

  it('gives a single-day event exactly the window between its own start and end', () => {
    expect(
      buildAgendaGrid({ startsAt: '2026-05-13T09:00:00.000Z', endsAt: '2026-05-13T12:00:00.000Z' }),
    ).toEqual({
      windowDays: 1,
      days: [
        {
          day: '2026-05-13',
          slots: [
            { startTime: '09:00', endTime: '10:00' },
            { startTime: '10:00', endTime: '11:00' },
            { startTime: '11:00', endTime: '12:00' },
          ],
        },
      ],
    })
  })

  it('opens the first day at the event start, every later day at the midnight it begins', () => {
    const grid = buildAgendaGrid({
      startsAt: '2026-05-13T09:00:00.000Z',
      endsAt: '2026-05-15T13:00:00.000Z',
    })

    expect(grid.days.map((day) => day.day)).toEqual(['2026-05-13', '2026-05-14', '2026-05-15'])
    expect(startTimes(grid.days[0]?.slots ?? [])).toEqual(WORKING_DAY_FROM_09)
    // The interior day is inside the window from end to end, so all of it is
    // placeable: the event has been running since this day's own midnight, and
    // neither the start time of day nor the last day's close applies to it.
    expect(startTimes(grid.days[1]?.slots ?? [])).toEqual(hoursFrom(0, 24))
    // A day closes at the midnight that ends it, the same bound a placed
    // session has (latestAgendaEnd).
    expect(grid.days[0]?.slots.at(-1)).toEqual({ startTime: '23:00', endTime: '00:00' })
    expect(startTimes(grid.days[2]?.slots ?? [])).toEqual(hoursFrom(0, 13))
  })

  it('keeps the afternoon reachable on every day the window still covers it', () => {
    const grid = buildAgendaGrid({
      startsAt: '2026-05-13T09:00:00.000Z',
      endsAt: '2026-05-15T10:00:00.000Z',
    })

    expect(startTimes(grid.days[0]?.slots ?? [])).toContain('14:00')
    expect(startTimes(grid.days[1]?.slots ?? [])).toContain('14:00')
    // The last day stops at 10:00 because that is when the event is over — but
    // it starts at midnight, because the event was already running.
    expect(startTimes(grid.days[2]?.slots ?? [])).toEqual(hoursFrom(0, 10))
  })

  it('offers the final morning of an event that ends before its own start time of day', () => {
    const grid = buildAgendaGrid({
      startsAt: '2026-05-13T09:00:00.000Z',
      endsAt: '2026-05-15T08:30:00.000Z',
    })

    expect(grid.days.map((day) => day.day)).toEqual(['2026-05-13', '2026-05-14', '2026-05-15'])
    expect(grid.days[0]?.slots).toHaveLength(15)
    expect(grid.days[1]?.slots).toHaveLength(24)
    // The event runs until 08:30 on its last day, so that morning holds eight
    // whole sessions. Closing this day at the start time of day would offer
    // none of them and leave the day unplaceable, while the server accepts
    // every one.
    expect(startTimes(grid.days[2]?.slots ?? [])).toEqual(hoursFrom(0, 8))
  })

  it('keeps every hour of an evening-start event placeable, its final morning included', () => {
    const grid = buildAgendaGrid({
      startsAt: '2026-05-15T18:00:00.000Z',
      endsAt: '2026-05-17T18:00:00.000Z',
    })

    expect(grid.days.map((day) => day.day)).toEqual(['2026-05-15', '2026-05-16', '2026-05-17'])
    expect(startTimes(grid.days[0]?.slots ?? [])).toEqual(hoursFrom(18, 24))
    expect(startTimes(grid.days[1]?.slots ?? [])).toEqual(hoursFrom(0, 24))
    expect(startTimes(grid.days[2]?.slots ?? [])).toEqual(hoursFrom(0, 18))
  })

  it('keeps the hours a window carries past a midnight placeable on the day they fall on', () => {
    expect(
      buildAgendaGrid({ startsAt: '2026-12-31T23:00:00.000Z', endsAt: '2027-01-01T04:00:00.000Z' })
        .days,
    ).toEqual([
      { day: '2026-12-31', slots: [{ startTime: '23:00', endTime: '00:00' }] },
      {
        day: '2027-01-01',
        slots: [
          { startTime: '00:00', endTime: '01:00' },
          { startTime: '01:00', endTime: '02:00' },
          { startTime: '02:00', endTime: '03:00' },
          { startTime: '03:00', endTime: '04:00' },
        ],
      },
    ])
  })

  it('lists the day of a window too short to hold one session, with no slots on it', () => {
    expect(
      buildAgendaGrid({ startsAt: '2026-05-13T09:00:00.000Z', endsAt: '2026-05-13T09:30:00.000Z' })
        .days,
    ).toEqual([{ day: '2026-05-13', slots: [] }])
    expect(
      buildAgendaGrid({ startsAt: '2026-05-13T09:00:00.000Z', endsAt: '2026-05-13T09:45:00.000Z' })
        .days,
    ).toEqual([{ day: '2026-05-13', slots: [] }])

    // The same half hour spread across three days is a different window: it
    // runs continuously, so the last day carries nine whole sessions before it
    // ends, and only a day the window barely touches is left with none.
    const acrossDays = buildAgendaGrid({
      startsAt: '2026-05-13T09:00:00.000Z',
      endsAt: '2026-05-15T09:30:00.000Z',
    })
    expect(acrossDays.days).toHaveLength(3)
    expect(acrossDays.days[0]?.slots).toHaveLength(15)
    expect(startTimes(acrossDays.days[2]?.slots ?? [])).toEqual(hoursFrom(0, 9))

    // A window ending exactly on a midnight covers none of the day it names.
    expect(
      buildAgendaGrid({
        startsAt: '2026-05-13T09:00:00.000Z',
        endsAt: '2026-05-14T00:00:00.000Z',
      }).days.at(-1),
    ).toEqual({ day: '2026-05-14', slots: [] })
  })

  // A runaway window is still bounded — a board of a thousand days is not a
  // board anyone can use — but the bound is now something the grid SAYS rather
  // than something it does quietly. `windowDays` is how many days the window
  // actually covers, so a reader can always tell a listed day from one the
  // board stops short of, and never has to guess which of the two it is
  // looking at.
  it('says how many days the window covers when it lists fewer than all of them', () => {
    const grid = buildAgendaGrid({
      startsAt: '2026-01-01T09:00:00.000Z',
      endsAt: '2026-12-31T17:00:00.000Z',
    })

    expect(grid.days).toHaveLength(31)
    expect(grid.windowDays).toBe(365)
    expect(grid.days.at(-1)?.slots.at(-1)).toEqual({ startTime: '23:00', endTime: '00:00' })
  })

  it('reports the full length of a window it lists end to end', () => {
    expect(
      buildAgendaGrid({ startsAt: '2026-05-13T09:00:00.000Z', endsAt: '2026-05-15T17:00:00.000Z' })
        .windowDays,
    ).toBe(3)
    expect(
      buildAgendaGrid({ startsAt: '2026-05-13T09:00:00.000Z', endsAt: '2026-05-13T17:00:00.000Z' })
        .windowDays,
    ).toBe(1)
  })
})

// One rule decides whether a (day, start, end) belongs to an event window, and
// both the grid an organizer is offered and the placement a server accepts are
// held to it. Before this, the two disagreed: the grid clipped every day to the
// window while the server only checked the calendar date, so a nine-to-five
// event accepted sixteen hours a day the board never offered.
describe('the one rule a placement is judged by', () => {
  interface Window {
    readonly name: string
    readonly startsAt: string
    readonly endsAt: string
  }

  const WINDOWS: readonly Window[] = [
    {
      name: 'a single working day',
      startsAt: '2026-05-13T09:00:00.000Z',
      endsAt: '2026-05-13T17:00:00.000Z',
    },
    {
      name: 'three working days',
      startsAt: '2026-05-13T09:00:00.000Z',
      endsAt: '2026-05-15T17:00:00.000Z',
    },
    {
      name: 'an evening start and a morning end',
      startsAt: '2026-05-13T18:00:00.000Z',
      endsAt: '2026-05-15T09:00:00.000Z',
    },
    {
      name: 'a half day',
      startsAt: '2026-05-13T09:00:00.000Z',
      endsAt: '2026-05-13T13:00:00.000Z',
    },
    {
      name: 'a window that crosses midnight',
      startsAt: '2026-12-31T23:00:00.000Z',
      endsAt: '2027-01-01T04:00:00.000Z',
    },
    {
      name: 'a window longer than the board lists',
      startsAt: '2026-05-01T09:00:00.000Z',
      endsAt: '2026-06-01T17:00:00.000Z',
    },
  ]

  /** The whole hour that begins at `start`, as a placement names it. */
  function hourFrom(start: string): { day: string; start: string; end: string } {
    return {
      day: start.slice(0, 10),
      start,
      end: new Date(Date.parse(start) + 3_600_000).toISOString(),
    }
  }

  function hourOn(day: string, hour: number): { day: string; start: string; end: string } {
    return hourFrom(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`)
  }

  it('accepts every slot the board offers, over every shape of window', () => {
    for (const window of WINDOWS) {
      for (const day of buildAgendaGrid(window).days) {
        for (const slot of day.slots) {
          const offered = gridSlotInstants(day.day, slot)
          expect([window.name, day.day, slot.startTime, isPlaceableSlot(window, offered)]).toEqual([
            window.name,
            day.day,
            slot.startTime,
            true,
          ])
        }
      }
    }
  })

  it('refuses the hour before a window opens and the hour after it closes, over every shape', () => {
    for (const window of WINDOWS) {
      const before = hourFrom(new Date(Date.parse(window.startsAt) - 3_600_000).toISOString())
      const after = hourFrom(window.endsAt)
      expect([window.name, isPlaceableSlot(window, before)]).toEqual([window.name, false])
      expect([window.name, isPlaceableSlot(window, after)]).toEqual([window.name, false])
    }
  })

  it('refuses the sixteen hours of a nine-to-five day the board never offered', () => {
    const window = { startsAt: '2026-05-13T09:00:00.000Z', endsAt: '2026-05-13T17:00:00.000Z' }
    const offered = new Set(
      (buildAgendaGrid(window).days[0]?.slots ?? []).map((slot) => slot.startTime),
    )
    const refused = Array.from({ length: 24 }, (_, hour) => hour).filter(
      (hour) => !isPlaceableSlot(window, hourOn('2026-05-13', hour)),
    )

    expect(offered.size).toBe(8)
    expect(refused).toHaveLength(16)
    for (const hour of refused) {
      expect(offered.has(`${String(hour).padStart(2, '0')}:00`)).toBe(false)
    }
  })

  it('refuses the hours an evening-to-morning window never offered on its two edges', () => {
    const window = { startsAt: '2026-05-13T18:00:00.000Z', endsAt: '2026-05-15T09:00:00.000Z' }
    const refusedOn = (day: string): number =>
      Array.from({ length: 24 }, (_, hour) => hour).filter(
        (hour) => !isPlaceableSlot(window, hourOn(day, hour)),
      ).length

    expect(refusedOn('2026-05-13')).toBe(18)
    expect(refusedOn('2026-05-15')).toBe(15)
    // The day the window covers end to end refuses nothing at all.
    expect(refusedOn('2026-05-14')).toBe(0)
  })

  it('accepts a day the window covers even when the board stops short of it', () => {
    const window = { startsAt: '2026-05-01T09:00:00.000Z', endsAt: '2026-06-01T17:00:00.000Z' }
    const grid = buildAgendaGrid(window)

    expect(grid.windowDays).toBe(32)
    expect(grid.days).toHaveLength(31)
    expect(grid.days.at(-1)?.day).toBe('2026-05-31')
    // So the board stops one day short of a day the window really offers and
    // the server really takes — which is why the board has to say so rather
    // than call that day one the window does not have.
    expect(isPlaceableSlot(window, hourOn('2026-06-01', 9))).toBe(true)
  })

  it('holds a session to the day it starts on, and takes the midnight that closes it', () => {
    const window = { startsAt: '2026-05-13T09:00:00.000Z', endsAt: '2026-05-16T00:00:00.000Z' }

    expect(
      isPlaceableSlot(window, {
        day: '2026-05-15',
        start: '2026-05-15T23:00:00.000Z',
        end: '2026-05-16T00:00:00.000Z',
      }),
    ).toBe(true)
    // A slot that runs on past that midnight spans two days and is refused.
    expect(
      isPlaceableSlot(window, {
        day: '2026-05-15',
        start: '2026-05-15T23:00:00.000Z',
        end: '2026-05-16T01:00:00.000Z',
      }),
    ).toBe(false)
    // A day that does not name the day the session starts on is refused too.
    expect(
      isPlaceableSlot(window, {
        day: '2026-05-14',
        start: '2026-05-15T09:00:00.000Z',
        end: '2026-05-15T10:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('accepts any well-formed slot while the event still has no dates', () => {
    expect(isPlaceableSlot(null, hourOn('2030-01-01', 3))).toBe(true)
    expect(
      isPlaceableSlot(null, {
        day: '2030-01-01',
        start: '2030-01-01T10:00:00.000Z',
        end: '2030-01-01T09:00:00.000Z',
      }),
    ).toBe(false)
  })
})

describe('agenda day bounds', () => {
  it('closes an agenda day at the midnight that follows it', () => {
    expect(latestAgendaEnd('2026-05-13')).toBe('2026-05-14T00:00:00.000Z')
    expect(latestAgendaEnd('2026-12-31')).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('agenda state transitions', () => {
  it('accepts draft → published and published → draft, and rejects both no-ops', () => {
    expect(transitionAgendaStatus('draft', 'published')).toBe('published')
    expect(transitionAgendaStatus('published', 'draft')).toBe('draft')
    expect(() => transitionAgendaStatus('draft', 'draft')).toThrow()
    expect(() => transitionAgendaStatus('published', 'published')).toThrow()
  })

  it('accepts unassigned → scheduled and scheduled → unassigned; rejects no-ops', () => {
    expect(transitionSessionAssignment('unassigned', 'scheduled')).toBe('scheduled')
    expect(transitionSessionAssignment('scheduled', 'unassigned')).toBe('unassigned')
    expect(() => transitionSessionAssignment('unassigned', 'unassigned')).toThrow()
    expect(() => transitionSessionAssignment('scheduled', 'scheduled')).toThrow()
  })
})
