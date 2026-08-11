import { describe, expect, it } from 'vitest'

import type { AgendaBoardDto, AgendaSessionDto } from '../../../src/application'
import {
  agendaAnnouncements,
  cellId,
  isBeyondListedDays,
  isMovingDrop,
  isOffWindowDay,
  parseCellId,
  placeableDays,
  placementFromCell,
  sessionsInCell,
  slotInstants,
  slotsForDay,
  timeOfDay,
  unlistedWindowDays,
  unmetAgendaPreconditions,
  unplacedSessions,
} from '../../../src/app/features/admin/agenda-board'

// The pure board model behind both placement paths: a drop target names a
// (day, room, slot) cell, and turning that cell into the placement the API
// stores is the one derivation dragging depends on. Slots belong to a day, not
// to the board, so what one day offers never speaks for another; and the
// prerequisites a placement needs are named one by one, never as a single
// "something is missing".

const ROOM_MAIN = { id: 'tax-room-main-hall', key: 'main-hall', label: 'Main hall' }
const ROOM_WORKSHOP = { id: 'tax-room-workshop-a', key: 'workshop-a', label: 'Workshop A' }
const TRACK_TALKS = { id: 'tax-track-talks', key: 'talks', label: 'Talks' }

const PLACED: AgendaSessionDto = {
  submissionId: 'submission-1',
  title: 'Scaling Postgres',
  day: '2026-05-13',
  start: '2026-05-13T09:00:00.000Z',
  end: '2026-05-13T10:00:00.000Z',
  roomId: ROOM_MAIN.id,
  roomLabel: ROOM_MAIN.label,
  trackId: TRACK_TALKS.id,
  trackLabel: TRACK_TALKS.label,
  position: 0,
  status: 'draft',
  assignment: 'scheduled',
}

const UNPLACED: AgendaSessionDto = {
  ...PLACED,
  submissionId: 'submission-2',
  title: 'Postgres at the edge',
  start: '2026-05-13T08:00:00.000Z',
  end: '2026-05-13T09:00:00.000Z',
  roomId: null,
  roomLabel: null,
  trackId: null,
  trackLabel: null,
  position: null,
  assignment: 'unassigned',
}

const BOARD: AgendaBoardDto = {
  eventId: 'event-1',
  slug: 'demo-conf-2026',
  timezone: 'Europe/Berlin',
  windowDays: 2,
  days: [
    {
      day: '2026-05-13',
      slots: [
        { startTime: '08:00', endTime: '09:00' },
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '23:00', endTime: '00:00' },
      ],
    },
    {
      day: '2026-05-14',
      slots: [
        { startTime: '09:00', endTime: '10:00' },
        { startTime: '10:00', endTime: '11:00' },
      ],
    },
  ],
  rooms: [ROOM_MAIN, ROOM_WORKSHOP],
  tracks: [TRACK_TALKS],
  sessions: [PLACED, UNPLACED],
  conflicts: [],
  views: { list: [], day: {}, week: {}, track: {}, room: {} },
}

describe('agenda board cells', () => {
  it('round-trips a cell identifier', () => {
    const id = cellId('2026-05-13', ROOM_MAIN.id, '09:00')

    expect(parseCellId(id)).toEqual({
      day: '2026-05-13',
      roomId: ROOM_MAIN.id,
      startTime: '09:00',
    })
    expect(parseCellId('nonsense')).toBeNull()
  })

  it('turns a slot into UTC instants, including one that closes at midnight', () => {
    expect(slotInstants('2026-05-13', { startTime: '09:00', endTime: '10:00' })).toEqual({
      start: '2026-05-13T09:00:00.000Z',
      end: '2026-05-13T10:00:00.000Z',
    })
    expect(slotInstants('2026-05-13', { startTime: '23:00', endTime: '00:00' })).toEqual({
      start: '2026-05-13T23:00:00.000Z',
      end: '2026-05-14T00:00:00.000Z',
    })
    expect(timeOfDay('2026-05-13T09:00:00.000Z')).toBe('09:00')
  })

  it('lists the sessions a cell already holds and the ones with no place yet', () => {
    expect(
      sessionsInCell(BOARD, '2026-05-13', ROOM_MAIN.id, '09:00').map(
        (session) => session.submissionId,
      ),
    ).toEqual([PLACED.submissionId])
    expect(sessionsInCell(BOARD, '2026-05-13', ROOM_WORKSHOP.id, '09:00')).toEqual([])
    expect(unplacedSessions(BOARD).map((session) => session.submissionId)).toEqual([
      UNPLACED.submissionId,
    ])
  })
})

describe('the slots one day offers', () => {
  it('reads the slots off the day itself, never off another day', () => {
    expect(slotsForDay(BOARD, '2026-05-13').map((slot) => slot.startTime)).toEqual([
      '08:00',
      '09:00',
      '23:00',
    ])
    expect(slotsForDay(BOARD, '2026-05-14').map((slot) => slot.startTime)).toEqual([
      '09:00',
      '10:00',
    ])
    expect(slotsForDay(BOARD, '2026-05-15')).toEqual([])
  })

  it('counts only the days that actually offer a slot as placeable', () => {
    const withEmptyDay: AgendaBoardDto = {
      ...BOARD,
      days: [...BOARD.days, { day: '2026-05-15', slots: [] }],
    }

    expect(placeableDays(withEmptyDay).map((day) => day.day)).toEqual(['2026-05-13', '2026-05-14'])
  })
})

describe('the prerequisites a placement needs', () => {
  it('names nothing when the board can take a placement', () => {
    expect(unmetAgendaPreconditions(BOARD)).toEqual([])
  })

  it('names the missing event dates, and only those', () => {
    expect(unmetAgendaPreconditions({ ...BOARD, days: [] })).toEqual(['event-dates'])
  })

  it('names the unschedulable window rather than dates that are already set', () => {
    const noWholeSession: AgendaBoardDto = {
      ...BOARD,
      days: [{ day: '2026-05-13', slots: [] }],
    }

    expect(unmetAgendaPreconditions(noWholeSession)).toEqual(['schedulable-time'])
  })

  it('names the missing rooms even when the grid itself is complete', () => {
    expect(unmetAgendaPreconditions({ ...BOARD, rooms: [] })).toEqual(['rooms'])
  })

  it('names every prerequisite that is missing at once', () => {
    expect(unmetAgendaPreconditions({ ...BOARD, days: [], rooms: [] })).toEqual([
      'event-dates',
      'rooms',
    ])
  })
})

describe('dropping a session on a cell', () => {
  it('derives the placement the API stores, keeping the session track', () => {
    expect(
      placementFromCell(
        BOARD,
        PLACED.submissionId,
        cellId('2026-05-14', ROOM_WORKSHOP.id, '09:00'),
      ),
    ).toEqual({
      submissionId: PLACED.submissionId,
      placement: {
        day: '2026-05-14',
        roomId: ROOM_WORKSHOP.id,
        trackId: TRACK_TALKS.id,
        start: '2026-05-14T09:00:00.000Z',
        end: '2026-05-14T10:00:00.000Z',
      },
    })
  })

  it('leaves a session without a track untracked', () => {
    expect(
      placementFromCell(BOARD, UNPLACED.submissionId, cellId('2026-05-13', ROOM_MAIN.id, '08:00')),
    ).toEqual({
      submissionId: UNPLACED.submissionId,
      placement: {
        day: '2026-05-13',
        roomId: ROOM_MAIN.id,
        trackId: null,
        start: '2026-05-13T08:00:00.000Z',
        end: '2026-05-13T09:00:00.000Z',
      },
    })
  })

  // Saving the taxonomy replaces every room and track and mints a fresh id for
  // each, so a session placed before that save carries ids nothing on the board
  // matches. The keyboard form was already held to what it displays; the drag
  // path sent the stored track straight through, and the server answered "the
  // track is not a track of this event" — surfaced to the organizer as a bare
  // "Could not place the session." A drop can only ever mean what the board
  // shows, so an id the board does not offer is not carried into the request.
  it('never sends a track the board no longer offers', () => {
    const stale: AgendaSessionDto = { ...UNPLACED, trackId: 'track-OLD', trackLabel: null }
    const board: AgendaBoardDto = { ...BOARD, sessions: [PLACED, stale] }

    expect(
      placementFromCell(board, stale.submissionId, cellId('2026-05-13', ROOM_MAIN.id, '09:00')),
    ).toEqual({
      submissionId: stale.submissionId,
      placement: {
        day: '2026-05-13',
        roomId: ROOM_MAIN.id,
        trackId: null,
        start: '2026-05-13T09:00:00.000Z',
        end: '2026-05-13T10:00:00.000Z',
      },
    })
  })

  it('refuses a cell whose room the board no longer offers', () => {
    expect(
      placementFromCell(BOARD, PLACED.submissionId, cellId('2026-05-13', 'room-OLD', '09:00')),
    ).toBeNull()
  })

  it('refuses the cell the session is already drawn in, which is no move at all', () => {
    const ownCell = cellId('2026-05-13', ROOM_MAIN.id, '09:00')

    expect(sessionsInCell(BOARD, '2026-05-13', ROOM_MAIN.id, '09:00')).toEqual([PLACED])
    expect(isMovingDrop(BOARD, PLACED.submissionId, ownCell)).toBe(false)
    expect(placementFromCell(BOARD, PLACED.submissionId, ownCell)).toBeNull()
  })

  // A cell shows a session by its start alone, so a session the board cannot
  // draw in whole — one running ninety minutes on a lattice of hour-long slots
  // — is drawn in the cell its start falls in. Deriving a placement from that
  // cell writes the cell's own end, half an hour short of the stored one, which
  // is the truncation the placement form refuses to make.
  it('never shortens a placement to the cell it is merely drawn in', () => {
    const ninetyMinutes: AgendaSessionDto = { ...PLACED, end: '2026-05-13T10:30:00.000Z' }
    const board: AgendaBoardDto = { ...BOARD, sessions: [ninetyMinutes, UNPLACED] }
    const ownCell = cellId('2026-05-13', ROOM_MAIN.id, '09:00')

    expect(sessionsInCell(board, '2026-05-13', ROOM_MAIN.id, '09:00')).toEqual([ninetyMinutes])
    expect(isMovingDrop(board, ninetyMinutes.submissionId, ownCell)).toBe(false)
    expect(placementFromCell(board, ninetyMinutes.submissionId, ownCell)).toBeNull()
  })

  // Normalising the track to what the board offers is right for a real move and
  // wrong for a drop that moves nothing: it would clear a track the organizer
  // never touched, on a session the taxonomy has already cost its labels.
  it('never drops the re-minted track of a session that was not moved', () => {
    const reminted: AgendaSessionDto = { ...PLACED, trackId: 'tax-track-talks-reminted' }
    const board: AgendaBoardDto = { ...BOARD, sessions: [reminted, UNPLACED] }

    expect(
      placementFromCell(board, reminted.submissionId, cellId('2026-05-13', ROOM_MAIN.id, '09:00')),
    ).toBeNull()
  })

  it('is still a move onto any other cell the board draws', () => {
    const elsewhere = cellId('2026-05-13', ROOM_WORKSHOP.id, '09:00')
    const earlierSlot = cellId('2026-05-13', ROOM_MAIN.id, '08:00')

    expect(isMovingDrop(BOARD, PLACED.submissionId, elsewhere)).toBe(true)
    expect(isMovingDrop(BOARD, PLACED.submissionId, earlierSlot)).toBe(true)
    expect(placementFromCell(BOARD, PLACED.submissionId, elsewhere)).not.toBeNull()
    // A session with no place yet is drawn in no cell, so every cell moves it.
    expect(
      isMovingDrop(BOARD, UNPLACED.submissionId, cellId('2026-05-13', ROOM_MAIN.id, '08:00')),
    ).toBe(true)
  })

  it('refuses a cell the board does not offer', () => {
    expect(placementFromCell(BOARD, PLACED.submissionId, 'nonsense')).toBeNull()
    expect(
      placementFromCell(BOARD, PLACED.submissionId, cellId('2026-05-13', ROOM_MAIN.id, '11:00')),
    ).toBeNull()
    // 08:00 is a slot of 2026-05-13 alone, so it is not a cell of 2026-05-14.
    expect(
      placementFromCell(BOARD, PLACED.submissionId, cellId('2026-05-14', ROOM_MAIN.id, '08:00')),
    ).toBeNull()
    expect(
      placementFromCell(BOARD, PLACED.submissionId, cellId('2026-05-15', ROOM_MAIN.id, '09:00')),
    ).toBeNull()
    expect(
      placementFromCell(BOARD, 'no-such-submission', cellId('2026-05-13', ROOM_MAIN.id, '09:00')),
    ).toBeNull()
  })
})

// A board lists a bounded number of days, so a long window reaches past the
// last day it draws. Those days are not days the window fails to offer — the
// server takes a placement on every one of them — so the board has to be able
// to tell the two apart before it says anything about either.
describe('the days a long window covers past the ones the board lists', () => {
  const LONG_BOARD: AgendaBoardDto = { ...BOARD, windowDays: 32 }

  it('counts the days the window covers and the board does not list', () => {
    expect(unlistedWindowDays(BOARD)).toBe(0)
    expect(unlistedWindowDays(LONG_BOARD)).toBe(30)
  })

  it('separates a placement past the last listed day from one past the window', () => {
    const beyondBoard: AgendaSessionDto = { ...PLACED, day: '2026-05-20' }
    const beyondWindow: AgendaSessionDto = { ...PLACED, day: '2026-07-20' }

    // 2026-05-13 + 32 days runs to 2026-06-13, so 2026-05-20 is inside the
    // window and merely past the two days this board draws.
    expect(isBeyondListedDays(beyondBoard, LONG_BOARD)).toBe(true)
    expect(isBeyondListedDays(beyondWindow, LONG_BOARD)).toBe(false)
    // A board that lists its whole window has nothing beyond it.
    expect(isBeyondListedDays(beyondBoard, BOARD)).toBe(false)
    // And an unplaced session claims no day at all.
    expect(isBeyondListedDays({ ...beyondBoard, assignment: 'unassigned' }, LONG_BOARD)).toBe(false)
  })

  // The listing runs from the window's first day forward and only ever drops
  // the tail, so a day it never lists and the tail never reaches is the one
  // case where the window really has moved past the placement — and the only
  // one a board may describe that way. A day it does list says nothing about
  // the window: the hours that day offers are drawn in whole slots, and a
  // placement between them is still one the window covers.
  it('separates a day outside the window from one the board draws in other hours', () => {
    const offWindow: AgendaSessionDto = { ...PLACED, day: '2026-07-20' }
    const listedDay: AgendaSessionDto = {
      ...PLACED,
      start: '2026-05-13T09:30:00.000Z',
      end: '2026-05-13T10:30:00.000Z',
    }

    expect(isOffWindowDay(offWindow, BOARD)).toBe(true)
    // 2026-05-13 is a day this board draws, whatever hours it draws it in.
    expect(isOffWindowDay(listedDay, BOARD)).toBe(false)
    // A day inside a window the board stops short of is not outside it either.
    expect(isOffWindowDay({ ...PLACED, day: '2026-05-20' }, LONG_BOARD)).toBe(false)
    expect(isOffWindowDay({ ...offWindow, assignment: 'unassigned' }, BOARD)).toBe(false)
  })
})

describe('what a screen reader hears while a session is dragged', () => {
  const announcements = agendaAnnouncements(BOARD)
  const active = { id: PLACED.submissionId }
  const over = { id: cellId('2026-05-14', ROOM_WORKSHOP.id, '09:00') }

  it('names the session by its title and the cell by room, day and time', () => {
    expect(announcements.onDragStart({ active })).toBe('Picked up Scaling Postgres.')
    expect(announcements.onDragOver({ active, over })).toBe(
      'Scaling Postgres is over Workshop A on 2026-05-14 at 09:00.',
    )
    expect(announcements.onDragEnd({ active, over })).toBe(
      'Scaling Postgres was dropped into Workshop A on 2026-05-14 at 09:00.',
    )
    expect(announcements.onDragCancel({ active })).toBe(
      'Dragging Scaling Postgres was cancelled. It kept its place.',
    )
  })

  it('never reads out a submission id or a raw cell identifier', () => {
    const spoken = [
      announcements.onDragStart({ active }),
      announcements.onDragOver({ active, over }),
      announcements.onDragOver({ active, over: null }),
      announcements.onDragEnd({ active, over }),
      announcements.onDragEnd({ active, over: null }),
      announcements.onDragCancel({ active }),
    ].join(' ')

    expect(spoken).not.toContain(PLACED.submissionId)
    expect(spoken).not.toContain(ROOM_WORKSHOP.id)
    expect(spoken).not.toContain('|')
  })

  it('says a drop that landed nowhere changed nothing', () => {
    expect(announcements.onDragOver({ active, over: null })).toBe(
      'Scaling Postgres is over no slot.',
    )
    expect(announcements.onDragEnd({ active, over: null })).toBe(
      'Scaling Postgres was dropped outside the board and kept its place.',
    )
  })

  // A drop back into the cell the chip came from is as much a non-event as a
  // drop off the board, and nothing is written for it — so saying it was
  // "dropped into" the cell would report a placement that never happened.
  it('says a drop back into the same cell changed nothing either', () => {
    expect(
      announcements.onDragEnd({
        active,
        over: { id: cellId('2026-05-13', ROOM_MAIN.id, '09:00') },
      }),
    ).toBe(
      'Scaling Postgres was dropped back into Main hall on 2026-05-13 at 09:00 and kept its place.',
    )
  })
})
