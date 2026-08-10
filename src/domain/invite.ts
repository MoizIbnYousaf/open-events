/**
 * Pure RFC 5545 (iCalendar) generator for speaker calendar invites.
 *
 * Framework- and persistence-free: callers pass the already-resolved
 * submission title and the event's UTC instants. The UID is derived from the
 * submission id alone, so re-issuing an invite for the same submission always
 * produces the same UID and calendar clients update the existing entry instead
 * of creating a duplicate.
 */
import type { UtcInstant } from './event.ts'
import type { SubmissionId } from './submission.ts'

/** UID right-hand side; part of the stable published identity of an invite. */
export const INVITE_UID_DOMAIN = 'speakerops'

export const INVITE_PRODID = '-//SpeakerOps//Event Program//EN'

/** RFC 5545 §3.1: content lines are folded at 75 octets (CRLF + one space). */
const MAX_LINE_OCTETS = 75

const CRLF = '\r\n'

export interface CalendarInviteInput {
  readonly submissionId: SubmissionId
  readonly title: string
  readonly startsAt: UtcInstant
  readonly endsAt: UtcInstant
  readonly dtstamp: UtcInstant
}

/** Stable, submission-derived UID: `<submissionId>@speakerops`. */
export function buildInviteUid(submissionId: SubmissionId): string {
  const trimmed = submissionId.trim()
  if (trimmed.length === 0) {
    throw new Error('Calendar invite UID requires a non-empty submission id')
  }
  return `${trimmed}@${INVITE_UID_DOMAIN}`
}

/**
 * RFC 5545 §3.3.11 TEXT escaping. The backslash is escaped first so a literal
 * backslash never turns a following character into an escape sequence.
 */
export function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** UTC instant -> RFC 5545 basic form, e.g. '20260513T080000Z'. */
export function formatCalendarInstant(instant: UtcInstant): string {
  const parsed = Date.parse(instant)
  if (Number.isNaN(parsed)) {
    throw new Error('Calendar invite requires a parsable UTC instant')
  }
  return new Date(parsed)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function octetLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Folds one content line to at most 75 octets per physical line, continuing
 * with CRLF + a single space. Folding advances by whole code points, so a
 * multi-byte character is never split across two physical lines.
 */
export function foldCalendarLine(line: string): string {
  if (octetLength(line) <= MAX_LINE_OCTETS) return line
  const parts: string[] = []
  let current = ''
  let budget = MAX_LINE_OCTETS
  for (const codePoint of line) {
    const size = octetLength(codePoint)
    if (octetLength(current) + size > budget) {
      parts.push(current)
      current = ''
      // Continuation lines spend one octet on the leading space.
      budget = MAX_LINE_OCTETS - 1
    }
    current += codePoint
  }
  parts.push(current)
  const [first = '', ...rest] = parts
  return [first, ...rest.map((part) => ` ${part}`)].join(CRLF)
}

/** Renders a single-event VCALENDAR document with CRLF line endings. */
export function buildCalendarInvite(input: CalendarInviteInput): string {
  const dtstart = formatCalendarInstant(input.startsAt)
  const dtend = formatCalendarInstant(input.endsAt)
  if (Date.parse(input.endsAt) < Date.parse(input.startsAt)) {
    throw new Error('Calendar invite end instant precedes its start instant')
  }
  const contentLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${INVITE_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${buildInviteUid(input.submissionId)}`,
    `DTSTAMP:${formatCalendarInstant(input.dtstamp)}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeCalendarText(input.title)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${contentLines.map(foldCalendarLine).join(CRLF)}${CRLF}`
}
