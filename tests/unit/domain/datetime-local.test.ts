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

  it('returns null for a blank box', () => {
    expect(datetimeLocalToUtcInstant('', 'Europe/Berlin')).toBeNull()
  })
})
