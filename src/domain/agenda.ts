/**
 * Agenda domain vocabulary grounded in committed taxonomy, submission, and
 * event identifiers plus the agenda session's own day and status. Pure
 * functions provide deterministic placement, room/speaker/track conflict
 * detection, aggregate projections, user-facing views, and valid state
 * transitions.
 */

import type { EventDates, UtcInstant } from './event.ts'

export type AgendaSessionStatus = 'draft' | 'published'

export type AgendaSessionAssignment = 'unassigned' | 'scheduled'

export type AgendaConflictKind = 'room' | 'speaker' | 'track'

export interface AgendaSessionInput {
  readonly submissionId: string
  readonly eventId: string
  readonly trackId: string | null
  readonly roomId: string | null
  readonly day: string
  readonly start: string
  readonly end: string
  readonly status: AgendaSessionStatus
  readonly speakerIds: readonly string[]
}

export interface AgendaPlacementInput {
  readonly sessions: readonly AgendaSessionInput[]
  readonly rooms: readonly string[]
  readonly tracks: readonly string[]
}

export interface AgendaPlacement {
  readonly submissionId: string
  readonly eventId: string
  readonly trackId: string
  readonly roomId: string
  readonly day: string
  readonly start: string
  readonly end: string
  readonly position: number
  readonly speakerIds: readonly string[]
  readonly status?: AgendaSessionStatus
}

export interface AgendaConflict {
  readonly kind: AgendaConflictKind
  readonly first: string
  readonly second: string
}

export interface AgendaAggregates {
  readonly perTrack: Readonly<Record<string, readonly string[]>>
  readonly perRoom: Readonly<Record<string, readonly string[]>>
  readonly perDay: Readonly<Record<string, readonly string[]>>
  readonly perTimeSlot: Readonly<Record<string, readonly string[]>>
  readonly perStatus: Readonly<Record<string, readonly string[]>>
}

export interface Req014Views {
  readonly list: readonly string[]
  readonly day: Readonly<Record<string, readonly string[]>>
  readonly week: Readonly<Record<string, readonly string[]>>
  readonly track: Readonly<Record<string, readonly string[]>>
  readonly room: Readonly<Record<string, readonly string[]>>
}

/** Length of the placeholder slot a newly accepted session starts with. */
export const DEFAULT_SESSION_MINUTES = 60

/** The embedded (day, start, end) triple every agenda session must carry. */
export interface AgendaSlot {
  readonly day: string
  readonly start: UtcInstant
  readonly end: UtcInstant
}

/**
 * Placeholder slot for a session that has been accepted but not yet placed.
 * The agenda row requires a day and a start/end pair even while it is
 * `unassigned`, so acceptance anchors the session on a real instant (the event
 * start when it is configured, the acceptance instant otherwise) and the
 * organizer replaces it during placement.
 */
export function defaultAgendaSlot(anchor: UtcInstant): AgendaSlot {
  const startMs = Date.parse(anchor)
  if (Number.isNaN(startMs)) {
    throw new Error('An agenda slot requires a parsable UTC instant')
  }
  const start = new Date(startMs).toISOString()
  const end = new Date(startMs + DEFAULT_SESSION_MINUTES * 60_000).toISOString()
  return { day: start.slice(0, 10), start, end }
}

/** A `YYYY-MM-DD` agenda day. */
export function isAgendaDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
}

/**
 * The latest instant a session that starts on `day` may end: the midnight that
 * closes the day. The last slot the grid offers can run to that midnight, so it
 * is allowed; anything beyond it would hold its room for days the organizer
 * never placed it on.
 */
export function latestAgendaEnd(day: string): UtcInstant {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString()
}

/** One placeable cell of the agenda grid, as a UTC `HH:mm` time-of-day pair. */
export interface AgendaGridSlot {
  readonly startTime: string
  readonly endTime: string
}

/**
 * One day of the event window and the slots that day offers. Slots belong to a
 * day rather than to the grid: the days of an event are not interchangeable —
 * the event starts partway through the first and stops partway through the
 * last — so one shared slot list could only ever be right about one of them.
 */
export interface AgendaGridDay {
  readonly day: string
  readonly slots: readonly AgendaGridSlot[]
}

/**
 * The placeable days an event window offers, each with its own slots, together
 * with how many days that window covers in total.
 *
 * The two are not always the same number: a runaway window is listed only as
 * far as `MAX_AGENDA_DAYS`. `windowDays` is what lets a reader tell a day the
 * window does not cover from a day it covers that this grid stops short of —
 * the second is still a day the server places a session on, and calling it a
 * day the event does not have would be false.
 */
export interface AgendaGrid {
  readonly days: readonly AgendaGridDay[]
  readonly windowDays: number
}

/** Upper bound keeping a misconfigured event window from producing a huge grid. */
const MAX_AGENDA_DAYS = 31
const MINUTES_PER_DAY = 24 * 60
const MILLISECONDS_PER_DAY = 86_400_000

function minutesOfDay(instant: UtcInstant): number {
  const date = new Date(instant)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function formatTimeOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * The UTC instants one grid cell of `day` stands for. A slot whose end time is
 * not after its start time closes on the following day, so a cell running to
 * midnight still yields a start before its end.
 */
export function gridSlotInstants(day: string, slot: AgendaGridSlot): AgendaSlot {
  const endDay =
    slot.endTime > slot.startTime
      ? day
      : new Date(Date.parse(`${day}T00:00:00.000Z`) + MILLISECONDS_PER_DAY)
          .toISOString()
          .slice(0, 10)
  return {
    day,
    start: `${day}T${slot.startTime}:00.000Z`,
    end: `${endDay}T${slot.endTime}:00.000Z`,
  }
}

/**
 * THE rule that decides whether a (day, start, end) belongs to an event window.
 * One rule, exported once: `buildAgendaGrid` offers only slots this accepts and
 * the placement service accepts only slots this offers, so the set an organizer
 * is shown and the set the server takes cannot drift apart. They used to: the
 * grid clipped every day to the window while the server checked the calendar
 * date alone, and a nine-to-five event took sixteen hours a day that no cell of
 * the board ever offered.
 *
 * The rule is interval clipping, plus the day bound a stored session carries:
 *
 *  - the slot must be well formed — a real `YYYY-MM-DD` day, two parsable
 *    instants, and a start before its end;
 *  - `day` must be the day the session starts on, and the session must end no
 *    later than the midnight that closes that day (`latestAgendaEnd`), because
 *    a session that ran past it would hold its room across days it was never
 *    placed on;
 *  - and the whole interval must lie inside the window: `start` no earlier than
 *    the event's start and `end` no later than the event's end.
 *
 * An event with no dates configured yet has no window to be inside, so any
 * well-formed slot is placeable — the dates are set first and the placements
 * they would contradict are reported afterwards.
 */
export function isPlaceableSlot(dates: EventDates | null, slot: AgendaSlot): boolean {
  if (!isAgendaDay(slot.day)) return false
  const startMs = Date.parse(slot.start)
  const endMs = Date.parse(slot.end)
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return false
  if (slot.day !== slot.start.slice(0, 10)) return false
  if (endMs > Date.parse(latestAgendaEnd(slot.day))) return false
  if (dates === null) return true
  return startMs >= Date.parse(dates.startsAt) && endMs <= Date.parse(dates.endsAt)
}

/**
 * The whole `DEFAULT_SESSION_MINUTES` cells of one day that the window really
 * holds. Candidates are cut from `openMinutes` onwards and every one of them is
 * put to `isPlaceableSlot`, so a cell reaches the board only if a placement into
 * it would be accepted.
 */
function placeableSlotsOfDay(
  dates: EventDates,
  day: string,
  openMinutes: number,
): readonly AgendaGridSlot[] {
  const slots: AgendaGridSlot[] = []
  for (
    let minute = openMinutes;
    minute + DEFAULT_SESSION_MINUTES <= MINUTES_PER_DAY;
    minute += DEFAULT_SESSION_MINUTES
  ) {
    const slot: AgendaGridSlot = {
      startTime: formatTimeOfDay(minute),
      endTime: formatTimeOfDay(minute + DEFAULT_SESSION_MINUTES),
    }
    if (isPlaceableSlot(dates, gridSlotInstants(day, slot))) slots.push(slot)
  }
  return slots
}

/**
 * The grid an organizer places sessions on, derived from the event's own
 * window, one day at a time.
 *
 * The daily window rule this adopts, in full: each day offers the part of the
 * event's own window that falls on it — the window clipped to that day.
 *
 *  - A day opens at the midnight that begins it, except the event's own first
 *    day, which opens at the event's start time of day because that instant is
 *    when the event begins.
 *  - A day closes at the midnight that ends it — exactly the bound
 *    `latestAgendaEnd` puts on a session placed on that day — except the
 *    event's own final day, which closes at the event's end time of day,
 *    because that instant is when the event is over.
 *  - So the first day runs from the event's start, the last day to the event's
 *    end, and an interior day — one the window covers from end to end — offers
 *    the whole of itself. A single-day event is both first and last: it runs
 *    from its start time to its end time.
 *
 * Neither edge of the window is a daily one, and treating either as one hides
 * hours the event really covers and the server really accepts:
 *
 *  - `endsAt` is the instant the whole event ends. Used as a daily close it
 *    would cap every day at the last day's finish, so an event ending at 10:00
 *    on its third morning would offer a single 09:00 slot for all three days
 *    and no afternoon session could be expressed anywhere.
 *  - `startsAt` is the instant the whole event begins. Used as a daily open it
 *    would cut the same amount off every morning, so an event running from
 *    18:00 on one evening to 18:00 two days later would offer nothing at all on
 *    its final day — the day it covers most of — and nothing before 18:00 on
 *    the interior day it covers end to end.
 *
 * Each day is then sliced into whole `DEFAULT_SESSION_MINUTES` slots, so a day
 * with less than one session's worth of window offers none: a half-day event
 * that ends thirty minutes after it starts, or a last day the window ends on
 * within the hour after midnight. That day is still listed, with no slots on it
 * — a real answer about a configured window, which the organizer surface can
 * name, and never the same thing as an event that has no dates at all.
 *
 * None of that is a second rule, though: the clipping above is only how the
 * candidates are cut, and every candidate is then put to `isPlaceableSlot`,
 * which is the one rule the server places by as well. A cell is offered exactly
 * when a placement into it would be accepted.
 *
 * An event without dates (or one whose window ends before it starts) offers no
 * day at all — the dates are configured first. A window longer than
 * `MAX_AGENDA_DAYS` is listed only that far, because a board of a thousand days
 * is not a board anyone can read; `windowDays` then reports how long the window
 * really is, so the unlisted days can be named as days the board stops short of
 * rather than days the event does not have. They ARE days the event has: a
 * placement on one of them is accepted, and nothing here may quietly move it.
 */
export function buildAgendaGrid(dates: EventDates | null): AgendaGrid {
  if (dates === null) return { days: [], windowDays: 0 }
  const startMs = Date.parse(dates.startsAt)
  const endMs = Date.parse(dates.endsAt)
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return { days: [], windowDays: 0 }
  }
  const firstDayMs = Date.parse(`${dates.startsAt.slice(0, 10)}T00:00:00.000Z`)
  const lastDayMs = Date.parse(`${dates.endsAt.slice(0, 10)}T00:00:00.000Z`)
  const windowDays = Math.round((lastDayMs - firstDayMs) / MILLISECONDS_PER_DAY) + 1
  const openMinutes = minutesOfDay(dates.startsAt)
  const days: AgendaGridDay[] = []
  for (
    let dayMs = firstDayMs;
    dayMs <= lastDayMs && days.length < MAX_AGENDA_DAYS;
    dayMs += MILLISECONDS_PER_DAY
  ) {
    const day = new Date(dayMs).toISOString().slice(0, 10)
    days.push({
      day,
      slots: placeableSlotsOfDay(dates, day, dayMs === firstDayMs ? openMinutes : 0),
    })
  }
  return { days, windowDays }
}

/**
 * Assigns every session a room, track, slot, and explicit position.
 * Sessions keep their own track/room when set; otherwise they deterministically
 * take the first item of the provided lists. Position is scoped per
 * room+slot: the first session in each combination starts at 0.
 */
export function placeSessions(input: AgendaPlacementInput): readonly AgendaPlacement[] {
  const positionCounters = new Map<string, number>()
  const placements: AgendaPlacement[] = []
  for (const session of input.sessions) {
    const trackId = session.trackId ?? input.tracks[0] ?? ''
    const roomId = session.roomId ?? input.rooms[0] ?? ''
    const slotKey = `${session.day}|${session.start}|${session.end}`
    const positionKey = `${roomId}|${slotKey}`
    const position = positionCounters.get(positionKey) ?? 0
    positionCounters.set(positionKey, position + 1)
    placements.push({
      submissionId: session.submissionId,
      eventId: session.eventId,
      trackId,
      roomId,
      day: session.day,
      start: session.start,
      end: session.end,
      position,
      speakerIds: session.speakerIds,
      status: session.status,
    })
  }
  return placements
}

/**
 * Two sessions overlap when their half-open [start, end) instant intervals
 * intersect. An identical (start, end) pair is the strongest overlap there is —
 * two sessions in one room at one time — so it counts too. The comparison is on
 * the instants alone: `day` is a denormalisation of the start, so a session
 * that runs from one evening into the next morning still holds its room across
 * the boundary. The position model lets both rows exist; reporting the overlap
 * is what lets the organizer resolve it.
 */
function overlaps(a: AgendaPlacement, b: AgendaPlacement): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * An empty identifier means "not set" (an unplaced session carries no room,
 * an unrouted session carries no track), and absence can never be shared.
 */
function sharesIdentifier(first: string, second: string): boolean {
  return first.length > 0 && first === second
}

function sharesSpeaker(a: AgendaPlacement, b: AgendaPlacement): boolean {
  const bSpeakerIds = new Set(b.speakerIds)
  return a.speakerIds.some((speakerId) => bSpeakerIds.has(speakerId))
}

function orderedPair(
  a: AgendaPlacement,
  b: AgendaPlacement,
): {
  readonly first: string
  readonly second: string
} {
  return a.submissionId < b.submissionId
    ? { first: a.submissionId, second: b.submissionId }
    : { first: b.submissionId, second: a.submissionId }
}

const CONFLICT_KIND_ORDER: readonly AgendaConflictKind[] = ['room', 'speaker', 'track']

/**
 * Deterministic conflict set: room (same room, overlapping), speaker (shared
 * speaker, overlapping), track (same track, different rooms, overlapping).
 * Overlapping includes the identical slot, so a same-room double booking is
 * reported. Returns every distinct (kind, first, second) exactly once, sorted
 * by kind then submission id.
 */
/** One session the organizer has not placed, and what it already carries. */
export interface UnplacedSession {
  readonly submissionId: string
  readonly trackId: string | null
  readonly speakerIds: readonly string[]
}

/** One proposed placement: where an unplaced session could go. */
export interface ProposedPlacement {
  readonly submissionId: string
  readonly day: string
  readonly start: UtcInstant
  readonly end: UtcInstant
  readonly roomId: string
}

/** A slot of the grid, paired with the day it belongs to. */
interface OpenSlot {
  readonly day: string
  readonly start: UtcInstant
  readonly end: UtcInstant
}

/**
 * Fills the empty slots of the grid with the sessions nobody has placed.
 *
 * Assisted rather than clever, and the distinction is deliberate: this proposes
 * placements a human can read, undo and override, and it refuses to create a
 * conflict rather than producing a fuller-looking board with a double-booked
 * speaker on it. A schedule an organizer has to audit is worth less than one
 * they can trust, so the rule is that anything this places would have been
 * legal if they had dragged it there themselves.
 *
 * Earliest free slot first, rooms in the organizer's own order, so the result
 * is deterministic and re-running it after placing a few by hand fills around
 * them instead of starting again. A session with nowhere legal left is simply
 * not placed — reported to the caller, never forced into a clash.
 */
export function proposeAgendaPlacements(
  grid: AgendaGrid,
  eventId: string,
  rooms: readonly string[],
  placed: readonly AgendaPlacement[],
  unplaced: readonly UnplacedSession[],
): readonly ProposedPlacement[] {
  if (rooms.length === 0) return []
  const openSlots: OpenSlot[] = grid.days.flatMap((day) =>
    day.slots.map((slot) => {
      const instants = gridSlotInstants(day.day, slot)
      return { day: day.day, start: instants.start, end: instants.end }
    }),
  )

  // Everything already on the board, plus everything this run has proposed, so
  // two proposals cannot collide with each other any more than with a session
  // an organizer placed by hand.
  const taken: AgendaPlacement[] = [...placed]
  const proposals: ProposedPlacement[] = []

  for (const session of unplaced) {
    let landed = false
    for (const slot of openSlots) {
      if (landed) break
      for (const roomId of rooms) {
        const candidate: AgendaPlacement = {
          submissionId: session.submissionId,
          eventId,
          trackId: session.trackId ?? '',
          roomId,
          day: slot.day,
          start: slot.start,
          end: slot.end,
          position: 0,
          speakerIds: session.speakerIds,
        }
        // The same conflict rule the board reports, asked BEFORE placing rather
        // than after: a proposal that would be flagged the moment it landed is
        // not a proposal, it is extra work for the organizer.
        if (findAgendaConflicts([...taken, candidate]).length > 0) continue
        taken.push(candidate)
        proposals.push({
          submissionId: session.submissionId,
          day: slot.day,
          start: slot.start,
          end: slot.end,
          roomId,
        })
        landed = true
        break
      }
    }
  }

  return proposals
}

export function findAgendaConflicts(
  placements: readonly AgendaPlacement[],
): readonly AgendaConflict[] {
  const conflicts: AgendaConflict[] = []
  for (let index = 0; index < placements.length; index += 1) {
    const a = placements[index]
    if (a === undefined) continue
    for (let other = index + 1; other < placements.length; other += 1) {
      const b = placements[other]
      if (b === undefined) continue
      if (!overlaps(a, b)) continue
      if (sharesIdentifier(a.roomId, b.roomId)) {
        conflicts.push({ kind: 'room', ...orderedPair(a, b) })
      }
      if (sharesSpeaker(a, b)) {
        conflicts.push({ kind: 'speaker', ...orderedPair(a, b) })
      }
      if (sharesIdentifier(a.trackId, b.trackId) && a.roomId !== b.roomId) {
        conflicts.push({ kind: 'track', ...orderedPair(a, b) })
      }
    }
  }
  return conflicts.sort((x, y) => {
    const kindDelta = CONFLICT_KIND_ORDER.indexOf(x.kind) - CONFLICT_KIND_ORDER.indexOf(y.kind)
    if (kindDelta !== 0) return kindDelta
    if (x.first !== y.first) return x.first < y.first ? -1 : 1
    return x.second < y.second ? -1 : x.second > y.second ? 1 : 0
  })
}

function append(groups: Record<string, string[]>, key: string, submissionId: string): void {
  const bucket = groups[key]
  if (bucket === undefined) {
    groups[key] = [submissionId]
  } else {
    bucket.push(submissionId)
  }
}

/**
 * Aggregate projections over the placements, each grouping submission ids in
 * placement order.
 */
export function buildAgendaAggregates(placements: readonly AgendaPlacement[]): AgendaAggregates {
  const perTrack: Record<string, string[]> = {}
  const perRoom: Record<string, string[]> = {}
  const perDay: Record<string, string[]> = {}
  const perTimeSlot: Record<string, string[]> = {}
  const perStatus: Record<string, string[]> = {}
  for (const placement of placements) {
    append(perTrack, placement.trackId, placement.submissionId)
    append(perRoom, placement.roomId, placement.submissionId)
    append(perDay, placement.day, placement.submissionId)
    append(
      perTimeSlot,
      `${placement.day}|${placement.start}|${placement.end}`,
      placement.submissionId,
    )
    append(perStatus, placement.status ?? '', placement.submissionId)
  }
  return { perTrack, perRoom, perDay, perTimeSlot, perStatus }
}

/** ISO-8601 week key (e.g. `2026-W20`) for a `YYYY-MM-DD` day. */
function isoWeekKey(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  const dayNumber = (date.getUTCDay() + 6) % 7
  const thursday = new Date(date)
  thursday.setUTCDate(date.getUTCDate() - dayNumber + 3)
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  const week =
    1 +
    Math.round(
      (thursday.getTime() -
        firstThursday.getTime() -
        3 * 86400000 +
        ((firstThursday.getUTCDay() + 6) % 7) * 86400000) /
        (7 * 86400000),
    )
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function bucketByWeek(
  perDay: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  const weeks: Record<string, string[]> = {}
  for (const day of Object.keys(perDay).sort()) {
    const week = isoWeekKey(day)
    for (const submissionId of perDay[day] ?? []) {
      append(weeks, week, submissionId)
    }
  }
  return weeks
}

/**
 * The key every derivation here files a session with no track under. A session
 * is placed in a room at a time; a track is optional, so the aggregate keys the
 * whole untracked group by the identifier it does not have — the empty string,
 * exactly as `sharesIdentifier` reads absence above.
 */
export const UNTRACKED_GROUP_KEY = ''

/**
 * The one word the product uses for that group. It is the word the placement
 * select already offers ("No track"), so the board, the views and the public
 * programme name the same state the same way.
 */
export const UNTRACKED_GROUP_LABEL = 'No track'

/**
 * What a track group is called, given whatever label the caller could resolve.
 *
 * Absence is a real answer and it needs a real word. Rendered as blank space it
 * is read as a continuation of whatever came before: on the organizer board the
 * untracked group printed no heading at all, so a screen reader filed its
 * sessions under the previous track, and on the public schedule the same
 * emptiness rendered as an empty chip — a badge with nothing in it. Both
 * surfaces derive their groups from `deriveReq014Views`, so the word lives here
 * with the grouping rather than being re-invented at each call site.
 */
export function trackGroupLabel(label: string): string {
  return label === UNTRACKED_GROUP_KEY ? UNTRACKED_GROUP_LABEL : label
}

/**
 * User-facing views derived from the aggregates: list = perTimeSlot flattened
 * in (day, start) order, day = perDay, week = perDay bucketed by ISO week,
 * track = perTrack, and room = perRoom.
 *
 * The track view keeps the untracked group as its own bucket under
 * `UNTRACKED_GROUP_KEY`; `trackGroupLabel` is what names it.
 */
export function deriveReq014Views(aggregates: AgendaAggregates): Req014Views {
  const timeSlotKeys = Object.keys(aggregates.perTimeSlot).sort()
  const list: string[] = []
  for (const key of timeSlotKeys) {
    list.push(...(aggregates.perTimeSlot[key] ?? []))
  }
  return {
    list,
    day: aggregates.perDay,
    week: bucketByWeek(aggregates.perDay),
    track: aggregates.perTrack,
    room: aggregates.perRoom,
  }
}

/**
 * Publishing is reversible: draft → published puts a session on the public
 * programme and published → draft takes it back off, which is how a cancelled
 * session stops being served. Only the no-ops are invalid.
 */
export function transitionAgendaStatus(
  from: AgendaSessionStatus,
  to: AgendaSessionStatus,
): AgendaSessionStatus {
  if (from !== to) return to
  throw new Error(`Invalid agenda status transition: ${from} -> ${to}`)
}

/** Only unassigned → scheduled and scheduled → unassigned are valid. */
export function transitionSessionAssignment(
  from: AgendaSessionAssignment,
  to: AgendaSessionAssignment,
): AgendaSessionAssignment {
  if (from === 'unassigned' && to === 'scheduled') return to
  if (from === 'scheduled' && to === 'unassigned') return to
  throw new Error(`Invalid session assignment transition: ${from} -> ${to}`)
}
