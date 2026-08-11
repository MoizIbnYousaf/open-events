import type {
  AgendaBoardDto,
  AgendaOptionDto,
  AgendaSessionDto,
  PlaceAgendaSessionInput,
} from '../../../application'
import { gridSlotInstants, type AgendaGridDay, type AgendaGridSlot } from '../../../domain/agenda'

/** One placement the board asks the API to persist. */
export interface AgendaPlacementRequest {
  readonly submissionId: string
  readonly placement: PlaceAgendaSessionInput
}

/**
 * A prerequisite a placement needs, named so the page can say which one is
 * actually missing instead of reporting a single undifferentiated "nothing can
 * be placed":
 *
 *  - `event-dates` — the event has no window, so there is no day to place on;
 *  - `schedulable-time` — the window is real but no day of it holds a whole
 *    session, so there is no slot to place into;
 *  - `rooms` — the taxonomy carries no room, so there is nowhere to place to.
 *
 * They are independent: acceptance materialises agenda rows without consulting
 * the taxonomy, and the grid comes from the event window alone, so a board can
 * miss any of them on its own or several at once.
 */
export type AgendaPreconditionId = 'event-dates' | 'schedulable-time' | 'rooms'

/** The slots one day offers; a day the board does not carry offers none. */
export function slotsForDay(board: AgendaBoardDto, day: string): readonly AgendaGridSlot[] {
  return board.days.find((option) => option.day === day)?.slots ?? []
}

/** The days that offer at least one slot — the only days a placement can name. */
export function placeableDays(board: AgendaBoardDto): readonly AgendaGridDay[] {
  return board.days.filter((option) => option.slots.length > 0)
}

/**
 * Every prerequisite this board is missing, in the order an organizer meets
 * them. Empty means a placement can be made; anything else names what to fix.
 * A window that yields no slot is only reported once there are days to report
 * it about, so "no dates" and "no schedulable time" are never both claimed.
 */
export function unmetAgendaPreconditions(board: AgendaBoardDto): readonly AgendaPreconditionId[] {
  const unmet: AgendaPreconditionId[] = []
  if (board.days.length === 0) unmet.push('event-dates')
  else if (placeableDays(board).length === 0) unmet.push('schedulable-time')
  if (board.rooms.length === 0) unmet.push('rooms')
  return unmet
}

function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/**
 * The UTC instants a grid cell stands for, as the domain derives them, so a
 * dropped cell and an offered cell can never mean two different instants.
 */
export function slotInstants(
  day: string,
  slot: AgendaGridSlot,
): { readonly start: string; readonly end: string } {
  const { start, end } = gridSlotInstants(day, slot)
  return { start, end }
}

/**
 * The stored id when the board still offers it, and null when it does not.
 * Saving the taxonomy replaces every room and track and mints a fresh id for
 * each, so a placement made before that save carries ids no option on the board
 * matches. Sending one back is a placement the server can only reject, and the
 * organizer sees a bare failure with no way to tell which id was stale — so
 * neither writer carries an id the board never offered.
 */
export function offeredOptionId(
  options: readonly AgendaOptionDto[],
  id: string | null,
): string | null {
  return id !== null && options.some((option) => option.id === id) ? id : null
}

/** The `HH:mm` UTC time of day an instant falls on. */
export function timeOfDay(instant: string): string {
  return instant.slice(11, 16)
}

/** Identifier of one droppable board cell. */
export function cellId(day: string, roomId: string, startTime: string): string {
  return `${day}|${roomId}|${startTime}`
}

export function parseCellId(
  value: string,
): { readonly day: string; readonly roomId: string; readonly startTime: string } | null {
  const [day, roomId, startTime] = value.split('|')
  if (day === undefined || roomId === undefined || startTime === undefined) return null
  return { day, roomId, startTime }
}

/** The human name of one session chip, or null when the board has no such session. */
export function sessionLabel(board: AgendaBoardDto, submissionId: string): string | null {
  return board.sessions.find((session) => session.submissionId === submissionId)?.title ?? null
}

/** The human name of one board cell — room, day and start time — or null when it is not a cell of this board. */
export function cellLabel(board: AgendaBoardDto, cell: string): string | null {
  const target = parseCellId(cell)
  if (target === null) return null
  const room = board.rooms.find((option) => option.id === target.roomId)
  return room === undefined ? null : `${room.label} on ${target.day} at ${target.startTime}`
}

/** One end of a drag, as the board needs to name it. */
export interface AgendaDragSubject {
  readonly id: string | number
}

/** What a screen reader hears at each stage of a drag. */
export interface AgendaAnnouncements {
  onDragStart(args: { readonly active: AgendaDragSubject }): string
  onDragOver(args: {
    readonly active: AgendaDragSubject
    readonly over: AgendaDragSubject | null
  }): string
  onDragEnd(args: {
    readonly active: AgendaDragSubject
    readonly over: AgendaDragSubject | null
  }): string
  onDragCancel(args: { readonly active: AgendaDragSubject }): string
}

/**
 * The drag commentary for this board. The library's own defaults read the raw
 * draggable and droppable identifiers aloud — a submission id and a delimited
 * cell key — which tells a screen-reader user nothing. These name the session
 * by its title and the cell by its room, day and time instead.
 */
export function agendaAnnouncements(board: AgendaBoardDto): AgendaAnnouncements {
  const session = (subject: AgendaDragSubject): string =>
    sessionLabel(board, String(subject.id)) ?? 'the session'
  const cell = (target: AgendaDragSubject | null): string | null =>
    target === null ? null : cellLabel(board, String(target.id))
  return {
    onDragStart: ({ active }) => `Picked up ${session(active)}.`,
    onDragOver: ({ active, over }) => {
      const target = cell(over)
      return target === null
        ? `${session(active)} is over no slot.`
        : `${session(active)} is over ${target}.`
    },
    onDragEnd: ({ active, over }) => {
      const target = cell(over)
      if (over === null || target === null) {
        return `${session(active)} was dropped outside the board and kept its place.`
      }
      // A drop back where the chip started is as much a non-event as a drop off
      // the board — nothing is written for it — so calling it a placement would
      // report a move that never happened.
      return isMovingDrop(board, String(active.id), String(over.id))
        ? `${session(active)} was dropped into ${target}.`
        : `${session(active)} was dropped back into ${target} and kept its place.`
    },
    onDragCancel: ({ active }) => `Dragging ${session(active)} was cancelled. It kept its place.`,
  }
}

/** The sessions already placed in one cell, in board order. */
export function sessionsInCell(
  board: AgendaBoardDto,
  day: string,
  roomId: string,
  startTime: string,
): readonly AgendaSessionDto[] {
  return board.sessions.filter(
    (session) =>
      session.assignment === 'scheduled' &&
      session.day === day &&
      session.roomId === roomId &&
      timeOfDay(session.start) === startTime,
  )
}

/** Sessions the organizer has not placed anywhere yet. */
export function unplacedSessions(board: AgendaBoardDto): readonly AgendaSessionDto[] {
  return board.sessions.filter((session) => session.assignment !== 'scheduled')
}

/**
 * The cell this board draws the session's chip in — the inverse of
 * `sessionsInCell`, and held to the same rule: the cell its start falls in.
 * Null when the board draws no chip for it, which is every session with no
 * place yet.
 */
function drawnCellId(board: AgendaBoardDto, submissionId: string): string | null {
  const session = board.sessions.find((option) => option.submissionId === submissionId)
  if (session === undefined || session.assignment !== 'scheduled') return null
  return session.roomId === null
    ? null
    : cellId(session.day, session.roomId, timeOfDay(session.start))
}

/**
 * Whether dropping this session on this cell asks for a move at all.
 *
 * The pointer sensor starts a drag on the press, so a plain click on a chip is
 * a whole drag cycle that ends over the cell the chip was already drawn in —
 * and a cell drawn from a session's start alone is not the placement that
 * session holds. Re-deriving a placement from it writes the cell's own slot
 * back: a session stored 09:00–10:30 on a board of hour-long slots is shortened
 * by half an hour, and a track the taxonomy has re-minted is cleared, both from
 * a press the organizer never meant as a move and neither of them announced.
 * So a drop back into the cell a chip is already drawn in is not a placement.
 */
export function isMovingDrop(board: AgendaBoardDto, submissionId: string, cell: string): boolean {
  const drawn = drawnCellId(board, submissionId)
  if (drawn === null) return true
  const target = parseCellId(cell)
  return target === null || cellId(target.day, target.roomId, target.startTime) !== drawn
}

/**
 * The placement a drop on one cell stands for: the cell supplies the day, room
 * and slot, and the session keeps the track it already had — but only when the
 * board still offers that track. Null when the cell, its room or the session is
 * not one this board offers, so an unrecognised drop is dropped rather than
 * guessed at. The slot is looked up on the cell's own day, because a start time
 * one day offers is not a start time every day offers.
 *
 * A drop can only ever mean what the board shows. Sending the stored track
 * straight through meant that after a taxonomy save re-minted the ids, a drop
 * on a perfectly good cell was answered with "the track is not a track of this
 * event" and surfaced as a bare "Could not place the session." — with nothing
 * on screen to say which id was the stale one.
 *
 * And null when the drop moves nothing (`isMovingDrop`), because normalising a
 * placement the organizer never asked to change is how a session loses the half
 * hour or the track it was holding.
 */
export function placementFromCell(
  board: AgendaBoardDto,
  submissionId: string,
  cell: string,
): AgendaPlacementRequest | null {
  const target = parseCellId(cell)
  if (target === null) return null
  if (!board.rooms.some((room) => room.id === target.roomId)) return null
  const slot = slotsForDay(board, target.day).find(
    (option) => option.startTime === target.startTime,
  )
  if (slot === undefined) return null
  const session = board.sessions.find((option) => option.submissionId === submissionId)
  if (session === undefined) return null
  if (!isMovingDrop(board, submissionId, cell)) return null
  const { start, end } = slotInstants(target.day, slot)
  return {
    submissionId,
    placement: {
      day: target.day,
      roomId: target.roomId,
      trackId: offeredOptionId(board.tracks, session.trackId),
      start,
      end,
    },
  }
}

/**
 * How many days of the event window the board does not list. A very long window
 * is drawn only as far as it can usefully be read, so the board can stop short
 * of days the event really covers.
 */
export function unlistedWindowDays(board: AgendaBoardDto): number {
  return Math.max(0, board.windowDays - board.days.length)
}

/**
 * Whether the session sits on a day the window covers but the board stops short
 * of drawing. The listing only ever drops the tail of a contiguous window, so a
 * day after the last listed one and no later than the window's own last day is
 * a day the event really offers and the server really accepts — which is the
 * opposite of a day the window no longer has, and must never be described as
 * one. An unplaced session claims no day, so it is neither.
 */
export function isBeyondListedDays(session: AgendaSessionDto, board: AgendaBoardDto): boolean {
  if (session.assignment !== 'scheduled') return false
  if (unlistedWindowDays(board) === 0) return false
  const first = board.days[0]?.day
  const last = board.days.at(-1)?.day
  if (first === undefined || last === undefined) return false
  return session.day > last && session.day <= addDays(first, board.windowDays - 1)
}

/**
 * Whether the session sits on a day the event window does not cover — the only
 * case a board may describe that way. The listing runs from the window's first
 * day forward and only ever drops the tail (`isBeyondListedDays` names that
 * tail), so a day the board never lists and the tail never reaches is a day
 * outside the window: the organizer really has trimmed the event past it, and
 * the server really does refuse a placement there.
 *
 * A day the board DOES list says nothing of the sort. Each day is drawn in
 * whole slots counted from the hour that day opens, so a placement between
 * those slots — an event whose start of day has moved, a session longer than
 * one slot — is one the board cannot express and the window still covers. That
 * is what this separates: a day the window has lost from an hour the board
 * cannot draw. An unplaced session claims no day, so it is neither.
 */
export function isOffWindowDay(session: AgendaSessionDto, board: AgendaBoardDto): boolean {
  if (session.assignment !== 'scheduled') return false
  if (board.days.some((option) => option.day === session.day)) return false
  return !isBeyondListedDays(session, board)
}
