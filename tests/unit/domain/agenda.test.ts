import { describe, expect, it } from 'vitest'

import {
  buildAgendaAggregates,
  deriveReq014Views,
  findAgendaConflicts,
  placeSessions,
  transitionAgendaStatus,
  transitionSessionAssignment,
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
    expect(first).toEqual([
      { kind: 'room', first: 'submission-a', second: 'submission-b' },
      { kind: 'speaker', first: 'submission-a', second: 'submission-e' },
      { kind: 'track', first: 'submission-a', second: 'submission-f' },
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

describe('agenda state transitions', () => {
  it('accepts draft → published and rejects published → draft and draft → draft', () => {
    expect(transitionAgendaStatus('draft', 'published')).toBe('published')
    expect(() => transitionAgendaStatus('published', 'draft')).toThrow()
    expect(() => transitionAgendaStatus('draft', 'draft')).toThrow()
  })

  it('accepts unassigned → scheduled and scheduled → unassigned; rejects no-ops', () => {
    expect(transitionSessionAssignment('unassigned', 'scheduled')).toBe('scheduled')
    expect(transitionSessionAssignment('scheduled', 'unassigned')).toBe('unassigned')
    expect(() => transitionSessionAssignment('unassigned', 'unassigned')).toThrow()
    expect(() => transitionSessionAssignment('scheduled', 'scheduled')).toThrow()
  })
})
