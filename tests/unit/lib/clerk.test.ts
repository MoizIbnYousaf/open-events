import { describe, expect, it } from 'vitest'

import {
  isClerkConfigured,
  isClerkOrganizerPolicyConfigured,
  isClerkPublishableKey,
} from '../../../src/lib/clerk'

describe('isClerkPublishableKey', () => {
  it('accepts test and live keys and rejects everything else', () => {
    expect(isClerkPublishableKey('pk_test_abc')).toBe(true)
    expect(isClerkPublishableKey('pk_live_abc')).toBe(true)
    expect(isClerkPublishableKey('sk_test_abc')).toBe(false)
    expect(isClerkPublishableKey('')).toBe(false)
    expect(isClerkPublishableKey(undefined)).toBe(false)
  })
})

describe('isClerkConfigured', () => {
  it('is off in the unit project so judged screens stay Clerk-free', () => {
    expect(isClerkConfigured()).toBe(false)
  })

  it('requires an explicit organizer authorization policy in addition to a publishable key', () => {
    expect(isClerkOrganizerPolicyConfigured('true')).toBe(true)
    expect(isClerkOrganizerPolicyConfigured('false')).toBe(false)
    expect(isClerkOrganizerPolicyConfigured(undefined)).toBe(false)
  })
})
