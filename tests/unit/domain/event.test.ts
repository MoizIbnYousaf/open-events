import { describe, expect, it } from 'vitest'

import { EVENT_STATUSES, type Event, type EventDates } from '../../../src/domain'

const VALID_DATES: EventDates = {
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
}

function createEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
    slug: 'demo-conf-2026',
    name: 'DemoConf 2026',
    timezone: 'Europe/Berlin',
    status: 'draft',
    dates: VALID_DATES,
    ...overrides,
  }
}

/**
 * The domain layer has no runtime validation logic; these assertions pin the
 * invariant contract the rest of the application relies on, so any drift in
 * the vocabulary (statuses, UTC instants, IANA timezone, date ordering) shows
 * up here first.
 */
function expectValidEvent(event: Event): void {
  expect(event.id).toBeTruthy()
  expect(event.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  expect(event.name.trim().length).toBeGreaterThan(0)
  expect(event.timezone).toMatch(/^[A-Za-z_]+(?:\/[A-Za-z_]+)+$/)
  expect(EVENT_STATUSES).toContain(event.status)

  if (event.dates === null) {
    return
  }

  expect(event.dates.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(event.dates.endsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(Date.parse(event.dates.startsAt)).toBeLessThanOrEqual(Date.parse(event.dates.endsAt))
}

describe('domain event vocabulary', () => {
  it('defines the canonical lifecycle statuses in order', () => {
    expect(EVENT_STATUSES).toEqual(['draft', 'published', 'archived'])
    expect(new Set(EVENT_STATUSES).size).toBe(EVENT_STATUSES.length)
  })

  it('accepts a fully configured event with UTC dates', () => {
    expectValidEvent(createEvent())
  })

  it('accepts an event whose dates are not configured yet', () => {
    expectValidEvent(createEvent({ dates: null }))
  })

  it('requires the start instant to be at or before the end instant', () => {
    expectValidEvent(
      createEvent({
        dates: {
          startsAt: '2026-05-13T08:00:00.000Z',
          endsAt: '2026-05-13T08:00:00.000Z',
        },
      }),
    )
  })
})
