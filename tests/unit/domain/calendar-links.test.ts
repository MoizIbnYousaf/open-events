import { describe, expect, it } from 'vitest'

import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  type CalendarEventDetails,
} from '../../../src/domain/calendar-links'

const EVENT: CalendarEventDetails = {
  uid: 'session-1@open-events',
  title: 'Agents & APIs: café edition',
  start: '2026-10-25T00:30:00.000Z',
  end: '2026-10-25T01:30:00.000Z',
  location: 'Main Hall, Level 2',
  description: 'Line one\nLine two',
}

describe('calendar provider links', () => {
  it('builds a Google compose URL from canonical UTC session facts', () => {
    const url = new URL(buildGoogleCalendarUrl(EVENT))

    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe(EVENT.title)
    expect(url.searchParams.get('dates')).toBe('20261025T003000Z/20261025T013000Z')
    expect(url.searchParams.get('location')).toBe(EVENT.location)
    expect(url.searchParams.get('details')).toBe(EVENT.description)
  })

  it('builds an Outlook compose URL without changing the absolute instants', () => {
    const url = new URL(buildOutlookCalendarUrl(EVENT))

    expect(url.origin + url.pathname).toBe('https://outlook.live.com/calendar/0/deeplink/compose')
    expect(url.searchParams.get('path')).toBe('/calendar/action/compose')
    expect(url.searchParams.get('rru')).toBe('addevent')
    expect(url.searchParams.get('subject')).toBe(EVENT.title)
    expect(url.searchParams.get('startdt')).toBe(EVENT.start)
    expect(url.searchParams.get('enddt')).toBe(EVENT.end)
    expect(url.searchParams.get('location')).toBe(EVENT.location)
    expect(url.searchParams.get('body')).toBe(EVENT.description)
  })

  it('rejects invalid or reversed instants before constructing an external URL', () => {
    expect(() => buildGoogleCalendarUrl({ ...EVENT, start: 'not-a-date' })).toThrow(/parsable/i)
    expect(() => buildOutlookCalendarUrl({ ...EVENT, end: EVENT.start })).toThrow(/after/i)
  })
})
