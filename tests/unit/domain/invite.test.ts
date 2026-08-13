import { describe, expect, it } from 'vitest'

import {
  buildCalendarInvite,
  buildInviteUid,
  escapeCalendarText,
  formatCalendarInstant,
  foldCalendarLine,
  INVITE_PRODID,
} from '../../../src/domain'

const SUBMISSION_ID = 'submission-1'
const BASE_INPUT = {
  submissionId: SUBMISSION_ID,
  title: 'Workshop proposal',
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
  dtstamp: '2026-05-20T09:00:00.000Z',
} as const

/**
 * Fold-safe RFC5545 reader: splits on CRLF, unfolds continuation lines (a
 * leading single space or tab), then splits each content line at its first
 * unescaped colon. Never a snapshot — the parsed property table is the pin.
 */
function readCalendar(ics: string): { lines: string[]; properties: Map<string, string[]> } {
  const rawLines = ics.split('\r\n')
  const lines: string[] = []
  for (const rawLine of rawLines) {
    if ((rawLine.startsWith(' ') || rawLine.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''}${rawLine.slice(1)}`
      continue
    }
    lines.push(rawLine)
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const properties = new Map<string, string[]>()
  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const name = line.slice(0, separator)
    const value = line.slice(separator + 1)
    properties.set(name, [...(properties.get(name) ?? []), value])
  }
  return { lines, properties }
}

function octetLength(value: string): number {
  return new TextEncoder().encode(value).length
}

describe('buildInviteUid', () => {
  it('derives a stable submission-based UID', () => {
    expect(buildInviteUid(SUBMISSION_ID)).toBe('submission-1@open-events')
  })

  it('is deterministic across calls and distinct per submission', () => {
    expect(buildInviteUid(SUBMISSION_ID)).toBe(buildInviteUid(SUBMISSION_ID))
    expect(buildInviteUid('submission-2')).not.toBe(buildInviteUid(SUBMISSION_ID))
  })

  it('rejects an empty submission id', () => {
    expect(() => buildInviteUid('  ')).toThrow()
  })
})

describe('escapeCalendarText', () => {
  it('escapes backslash, semicolon, comma and newlines per RFC 5545', () => {
    expect(escapeCalendarText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d')
    expect(escapeCalendarText('line1\nline2')).toBe('line1\\nline2')
    expect(escapeCalendarText('line1\r\nline2')).toBe('line1\\nline2')
  })

  it('escapes the backslash first so escapes are never double-applied', () => {
    expect(escapeCalendarText('\\,')).toBe('\\\\\\,')
  })

  it('leaves colon and plain text untouched', () => {
    expect(escapeCalendarText('Talk: the sequel')).toBe('Talk: the sequel')
  })
})

describe('formatCalendarInstant', () => {
  it('formats a UTC instant as the RFC 5545 basic UTC form', () => {
    expect(formatCalendarInstant('2026-05-13T08:00:00.000Z')).toBe('20260513T080000Z')
  })

  it('rejects a non-parsable instant', () => {
    expect(() => formatCalendarInstant('not-a-date')).toThrow()
  })
})

describe('foldCalendarLine', () => {
  it('leaves a short line unfolded', () => {
    expect(foldCalendarLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('folds long lines to at most 75 octets per physical line', () => {
    const folded = foldCalendarLine(`SUMMARY:${'a'.repeat(400)}`)
    const physical = folded.split('\r\n')
    expect(physical.length).toBeGreaterThan(1)
    for (const line of physical) {
      expect(octetLength(line)).toBeLessThanOrEqual(75)
    }
    for (const line of physical.slice(1)) {
      expect(line.startsWith(' ')).toBe(true)
    }
  })

  it('never splits a multi-byte character across folds', () => {
    const folded = foldCalendarLine(`SUMMARY:${'é'.repeat(200)}`)
    for (const line of folded.split('\r\n')) {
      expect(octetLength(line)).toBeLessThanOrEqual(75)
      expect(line).not.toContain('�')
    }
    const unfolded = folded
      .split('\r\n')
      .map((line, index) => (index === 0 ? line : line.slice(1)))
      .join('')
    expect(unfolded).toBe(`SUMMARY:${'é'.repeat(200)}`)
  })
})

describe('buildCalendarInvite', () => {
  it('emits a well-formed VCALENDAR/VEVENT envelope in order', () => {
    const { lines } = readCalendar(buildCalendarInvite(BASE_INPUT))

    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR')
    expect(lines.indexOf('BEGIN:VEVENT')).toBeGreaterThan(0)
    expect(lines.indexOf('END:VEVENT')).toBe(lines.length - 2)
    expect(lines.indexOf('BEGIN:VEVENT')).toBeLessThan(lines.indexOf('END:VEVENT'))
  })

  it('pins VERSION and PRODID', () => {
    const { properties } = readCalendar(buildCalendarInvite(BASE_INPUT))

    expect(properties.get('VERSION')).toEqual(['2.0'])
    expect(properties.get('PRODID')).toEqual([INVITE_PRODID])
  })

  it('carries the stable submission-based UID', () => {
    const { properties } = readCalendar(buildCalendarInvite(BASE_INPUT))

    expect(properties.get('UID')).toEqual(['submission-1@open-events'])
    expect(buildCalendarInvite(BASE_INPUT)).toBe(buildCalendarInvite(BASE_INPUT))
  })

  it('carries DTSTAMP/DTSTART/DTEND from the supplied UTC instants', () => {
    const { properties } = readCalendar(buildCalendarInvite(BASE_INPUT))

    expect(properties.get('DTSTAMP')).toEqual(['20260520T090000Z'])
    expect(properties.get('DTSTART')).toEqual(['20260513T080000Z'])
    expect(properties.get('DTEND')).toEqual(['20260515T170000Z'])
  })

  it('carries the escaped submission title as SUMMARY', () => {
    const { properties } = readCalendar(
      buildCalendarInvite({ ...BASE_INPUT, title: 'Rust, C++; a\\tale\nof two' }),
    )

    expect(properties.get('SUMMARY')).toEqual(['Rust\\, C++\\; a\\\\tale\\nof two'])
  })

  it('uses CRLF line endings exclusively and never a bare LF', () => {
    const ics = buildCalendarInvite(BASE_INPUT)

    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
    expect(ics.replace(/\r\n/g, '')).not.toContain('\r')
  })

  it('folds an over-long SUMMARY while keeping it recoverable by an unfolding parser', () => {
    const title = 'Long ' + 'title '.repeat(40)
    const ics = buildCalendarInvite({ ...BASE_INPUT, title })
    const { properties } = readCalendar(ics)

    for (const line of ics.split('\r\n')) {
      expect(octetLength(line)).toBeLessThanOrEqual(75)
    }
    expect(properties.get('SUMMARY')).toEqual([escapeCalendarText(title)])
  })

  it('rejects an end instant that precedes the start instant', () => {
    expect(() =>
      buildCalendarInvite({ ...BASE_INPUT, endsAt: '2026-05-12T08:00:00.000Z' }),
    ).toThrow()
  })

  it('rejects an unparsable instant', () => {
    expect(() => buildCalendarInvite({ ...BASE_INPUT, startsAt: 'nope' })).toThrow()
  })
})
