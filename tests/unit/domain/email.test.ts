import { describe, expect, it } from 'vitest'

import { isNormalizedEmail, isValidEmailAddress, normalizeEmail } from '../../../src/domain'

describe('email normalization', () => {
  it('trims whitespace and lowercases', () => {
    expect(normalizeEmail('  Speaker.A@Example.TEST ')).toBe('speaker.a@example.test')
    expect(normalizeEmail('speaker-a@example.test')).toBe('speaker-a@example.test')
  })

  it('produces the canonical form used for deduplication', () => {
    const variants = [
      'Speaker.A@Example.TEST',
      '  speaker.a@example.test  ',
      'SPEAKER.A@EXAMPLE.TEST',
      'speaker.a@example.test',
    ]

    const canonical = 'speaker.a@example.test'
    for (const variant of variants) {
      expect(normalizeEmail(variant)).toBe(canonical)
    }
  })
})

describe('email structural validation', () => {
  it('accepts structurally valid addresses', () => {
    expect(isValidEmailAddress('speaker-a@example.test')).toBe(true)
    expect(isValidEmailAddress('speaker.a@example.co.uk')).toBe(true)
  })

  it('rejects addresses without a local or domain part', () => {
    expect(isValidEmailAddress('')).toBe(false)
    expect(isValidEmailAddress('@example.test')).toBe(false)
    expect(isValidEmailAddress('speaker@')).toBe(false)
    expect(isValidEmailAddress('speaker')).toBe(false)
  })

  it('rejects addresses with spaces or multiple @ signs', () => {
    expect(isValidEmailAddress('speaker @example.test')).toBe(false)
    expect(isValidEmailAddress('speaker@ex@ample.test')).toBe(false)
  })

  it('recognizes only canonical valid addresses as normalized', () => {
    expect(isNormalizedEmail('speaker.a@example.test')).toBe(true)
    expect(isNormalizedEmail('Speaker.A@example.test')).toBe(false)
    expect(isNormalizedEmail(' speaker.a@example.test')).toBe(false)
  })
})
