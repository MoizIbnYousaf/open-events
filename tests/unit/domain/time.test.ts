import { describe, expect, it } from 'vitest'

import { isValidUtcInstant, validateEventConfig, validateFormLimits } from '../../../src/domain'
import {
  MAX_ORGANIZER_SESSION_TTL_MS,
  MAX_SUBMITTER_SESSION_TTL_MS,
  MAX_SUBMITTER_TOKEN_TTL_MS,
  MIN_TTL_MS,
  assertValidTtl,
  isValidTtl,
} from '../../../src/application'
import { addMillis } from '../../../src/application'
import { eventFixture, openLimits } from '../helpers/fixtures'

describe('isValidUtcInstant', () => {
  it('accepts canonical UTC instants', () => {
    expect(isValidUtcInstant('2026-05-15T00:00:00.000Z')).toBe(true)
    expect(isValidUtcInstant('2026-05-15T23:59:59.999Z')).toBe(true)
  })

  it('rejects date-only, non-canonical, offset, and unparseable values', () => {
    expect(isValidUtcInstant('')).toBe(false)
    expect(isValidUtcInstant('2026-05-15')).toBe(false)
    expect(isValidUtcInstant('2026-05-15T00:00:00Z')).toBe(false)
    expect(isValidUtcInstant('2026-05-15T00:00:00.000')).toBe(false)
    expect(isValidUtcInstant('2026-05-15T00:00:00+02:00')).toBe(false)
    expect(isValidUtcInstant('2026-05-15T00:00:00.000Z ')).toBe(false)
    expect(isValidUtcInstant('not-a-date')).toBe(false)
  })
})

describe('time contract in limit and event validation', () => {
  it('rejects non-UTC instants in form limits', () => {
    const issues = validateFormLimits({
      ...openLimits,
      opensAt: '2026-05-15',
      closesAt: '2026-05-15T00:00:00+02:00',
    })

    expect(issues.filter((issue) => issue.code === 'invalid_utc_instant')).toHaveLength(2)
  })

  it('rejects non-UTC instants in event configuration', () => {
    const issues = validateEventConfig({
      ...eventFixture,
      dates: { startsAt: '2026-05-13', endsAt: '2026-05-15T17:00:00.000Z' },
    })

    expect(issues.some((issue) => issue.code === 'invalid_utc_instant')).toBe(true)
  })
})

describe('addMillis', () => {
  it('adds a positive finite duration to a canonical instant', () => {
    expect(addMillis('2026-05-15T00:00:00.000Z', 60_000)).toBe('2026-05-15T00:01:00.000Z')
  })

  it('rejects zero, negative, NaN, and infinite durations', () => {
    expect(() => addMillis('2026-05-15T00:00:00.000Z', 0)).toThrow(RangeError)
    expect(() => addMillis('2026-05-15T00:00:00.000Z', -1)).toThrow(RangeError)
    expect(() => addMillis('2026-05-15T00:00:00.000Z', Number.NaN)).toThrow(RangeError)
    expect(() => addMillis('2026-05-15T00:00:00.000Z', Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    )
  })

  it('rejects invalid base instants', () => {
    expect(() => addMillis('not-a-date', 1)).toThrow(RangeError)
    expect(() => addMillis('2026-05-15', 1)).toThrow(RangeError)
  })

  it('rejects overflow beyond the representable date range', () => {
    expect(() => addMillis('275760-09-13T00:00:00.000Z', 1)).toThrow(RangeError)
  })
})

describe('token/session TTL policy', () => {
  it('rejects zero, negative, NaN, fractional, and over-max TTLs', () => {
    expect(isValidTtl(0, 1000)).toBe(false)
    expect(isValidTtl(-1, 1000)).toBe(false)
    expect(isValidTtl(Number.NaN, 1000)).toBe(false)
    expect(isValidTtl(1.5, 1000)).toBe(false)
    expect(isValidTtl(1001, 1000)).toBe(false)
    expect(isValidTtl(1, 1000)).toBe(true)
    expect(isValidTtl(1000, 1000)).toBe(true)
  })

  it('throws a RangeError from assertValidTtl for invalid values', () => {
    expect(() => assertValidTtl(0, 1000)).toThrow(RangeError)
    expect(() => assertValidTtl(-5, 1000)).toThrow(RangeError)
    expect(() => assertValidTtl(Number.NaN, 1000)).toThrow(RangeError)
    expect(() => assertValidTtl(1, 1000)).not.toThrow()
  })

  it('defines positive bounded per-kind TTL ceilings', () => {
    expect(MIN_TTL_MS).toBe(1)
    expect(MAX_ORGANIZER_SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000)
    expect(MAX_SUBMITTER_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(MAX_SUBMITTER_SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
