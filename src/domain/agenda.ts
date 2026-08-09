/**
 * Agenda domain vocabulary grounded in committed taxonomy, submission, and
 * event identifiers plus the agenda session's own day and status. Pure
 * functions provide deterministic placement, room/speaker/track conflict
 * detection, aggregate projections, user-facing views, and valid state
 * transitions.
 */

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
 * Strictly-overlapping but not slot-identical sessions conflict. Identical
 * (day, start, end) slots are the deliberate multi-session co-location the
 * position model supports, so they never conflict.
 */
function overlaps(a: AgendaPlacement, b: AgendaPlacement): boolean {
  if (a.day !== b.day) return false
  if (a.start === b.start && a.end === b.end) return false
  return a.start < b.end && b.start < a.end
}

function sharesSpeaker(a: AgendaPlacement, b: AgendaPlacement): boolean {
  return a.speakerIds.some((speakerId) => b.speakerIds.includes(speakerId))
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
 * Returns every distinct (kind, first, second) exactly once, sorted by kind
 * then submission id.
 */
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
      if (a.roomId === b.roomId) {
        conflicts.push({ kind: 'room', ...orderedPair(a, b) })
      }
      if (sharesSpeaker(a, b)) {
        conflicts.push({ kind: 'speaker', ...orderedPair(a, b) })
      }
      if (a.trackId === b.trackId && a.roomId !== b.roomId) {
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
 * User-facing views derived from the aggregates: list = perTimeSlot flattened
 * in (day, start) order, day = perDay, week = perDay bucketed by ISO week,
 * track = perTrack, and room = perRoom.
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

/** Only draft → published is a valid agenda status transition. */
export function transitionAgendaStatus(
  from: AgendaSessionStatus,
  to: AgendaSessionStatus,
): AgendaSessionStatus {
  if (from === 'draft' && to === 'published') return to
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
