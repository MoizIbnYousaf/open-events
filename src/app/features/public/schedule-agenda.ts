import type { PublicScheduleSession } from '../../queries/public-schedule'

export { readPersonalSchedule, writePersonalSchedule } from '../../lib/personal-schedule'

export interface AgendaGridModel {
  readonly days: readonly string[]
  readonly rooms: readonly string[]
  readonly slots: readonly string[]
  readonly cells: ReadonlyMap<string, readonly PublicScheduleSession[]>
}

function localDay(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

function localTime(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function cellKey(day: string, room: string, slot: string): string {
  return `${day}|${room}|${slot}`
}

export function buildPublicAgenda(
  sessions: readonly PublicScheduleSession[],
  timezone: string,
): AgendaGridModel {
  const days = [...new Set(sessions.map((session) => localDay(session.start, timezone)))].sort()
  const rooms = [...new Set(sessions.map((session) => session.room || 'Unassigned'))].sort()
  const slots = [
    ...new Set(
      sessions.map(
        (session) => `${localTime(session.start, timezone)}–${localTime(session.end, timezone)}`,
      ),
    ),
  ].sort()
  const cells = new Map<string, PublicScheduleSession[]>()
  for (const session of sessions) {
    const key = cellKey(
      localDay(session.start, timezone),
      session.room || 'Unassigned',
      `${localTime(session.start, timezone)}–${localTime(session.end, timezone)}`,
    )
    const bucket = cells.get(key) ?? []
    bucket.push(session)
    cells.set(key, bucket)
  }
  return { days, rooms, slots, cells }
}

export function sessionsOnDay(
  sessions: readonly PublicScheduleSession[],
  timezone: string,
  day: string,
): readonly PublicScheduleSession[] {
  return sessions
    .filter((session) => localDay(session.start, timezone) === day)
    .sort((left, right) => left.start.localeCompare(right.start))
}

export { localDay, localTime }
