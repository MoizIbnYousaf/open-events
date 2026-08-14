export interface IcsEvent {
  readonly uid: string
  readonly title: string
  readonly start: string
  readonly end: string
  readonly location: string
  readonly description: string
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function icsStamp(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return new Date(parsed)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function fold(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  let rest = line
  parts.push(rest.slice(0, 75))
  rest = rest.slice(75)
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  return parts.join('\r\n')
}

/** VCALENDAR of published sessions. Times stay UTC; a calendar app localises. */
export function toIcsCalendar(name: string, events: readonly IcsEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Open Events//Programme//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${icsEscape(name)}`),
  ]
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      fold(`UID:${icsEscape(event.uid)}`),
      fold(`DTSTAMP:${icsStamp(event.start)}`),
      fold(`DTSTART:${icsStamp(event.start)}`),
      fold(`DTEND:${icsStamp(event.end)}`),
      fold(`SUMMARY:${icsEscape(event.title)}`),
    )
    if (event.location !== '') lines.push(fold(`LOCATION:${icsEscape(event.location)}`))
    if (event.description !== '') lines.push(fold(`DESCRIPTION:${icsEscape(event.description)}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
