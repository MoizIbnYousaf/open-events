import { describe, expect, it } from 'vitest'

import {
  datetimeLocalToUtcInstant,
  utcInstantToDatetimeLocal,
} from '../../../src/domain/datetime-local'

describe('datetime-local in an event timezone', () => {
  it('treats the typed clock as America/Los_Angeles, not UTC', () => {
    expect(datetimeLocalToUtcInstant('2026-05-13T09:00', 'America/Los_Angeles')).toBe(
      '2026-05-13T16:00:00.000Z',
    )
  })

  it('round-trips a stored instant back to the event wall clock', () => {
    const instant = '2026-05-13T16:00:00.000Z'
    expect(utcInstantToDatetimeLocal(instant, 'America/Los_Angeles')).toBe('2026-05-13T09:00')
  })

  it('rejects a wall clock that does not exist during spring-forward', () => {
    expect(datetimeLocalToUtcInstant('2026-03-08T02:30', 'America/Los_Angeles')).toBeNull()
  })

  it('chooses the earlier instant when a fall-back wall clock occurs twice', () => {
    expect(datetimeLocalToUtcInstant('2026-11-01T01:30', 'America/Los_Angeles')).toBe(
      '2026-11-01T08:30:00.000Z',
    )
  })

  it('returns null for a blank box or an invalid calendar value', () => {
    expect(datetimeLocalToUtcInstant('', 'Europe/Berlin')).toBeNull()
    expect(datetimeLocalToUtcInstant('2026-02-30T09:00', 'Europe/Berlin')).toBeNull()
  })
})
