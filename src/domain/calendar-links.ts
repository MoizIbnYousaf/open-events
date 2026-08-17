import { formatCalendarInstant } from './invite'

export interface CalendarEventDetails {
  readonly uid: string
  readonly title: string
  readonly start: string
  readonly end: string
  readonly location: string
  readonly description: string
}

function assertCalendarEvent(event: CalendarEventDetails): void {
  const start = Date.parse(event.start)
  const end = Date.parse(event.end)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error('Calendar provider link requires parsable UTC instants')
  }
  if (end <= start) throw new Error('Calendar provider link end must be after start')
}

export function buildGoogleCalendarUrl(event: CalendarEventDetails): string {
  assertCalendarEvent(event)
  const url = new URL('https://calendar.google.com/calendar/render')
  url.searchParams.set('action', 'TEMPLATE')
  url.searchParams.set(
    'dates',
    `${formatCalendarInstant(event.start)}/${formatCalendarInstant(event.end)}`,
  )
  url.searchParams.set('text', event.title)
  if (event.location !== '') url.searchParams.set('location', event.location)
  if (event.description !== '') url.searchParams.set('details', event.description)
  return url.toString()
}

export function buildOutlookCalendarUrl(event: CalendarEventDetails): string {
  assertCalendarEvent(event)
  const url = new URL('https://outlook.live.com/calendar/0/deeplink/compose')
  url.searchParams.set('path', '/calendar/action/compose')
  url.searchParams.set('rru', 'addevent')
  url.searchParams.set('subject', event.title)
  url.searchParams.set('startdt', event.start)
  url.searchParams.set('enddt', event.end)
  if (event.location !== '') url.searchParams.set('location', event.location)
  if (event.description !== '') url.searchParams.set('body', event.description)
  return url.toString()
}
