import { describe, expect, it } from 'vitest'

import {
  TURNSTILE_TEST_SITE_KEY,
  resolveTurnstileClientConfiguration,
} from '../../../src/lib/turnstile'

describe('Turnstile client configuration', () => {
  it('is visibly unavailable in production without a valid site key', () => {
    expect(resolveTurnstileClientConfiguration(undefined, false)).toEqual({
      state: 'unavailable',
      siteKey: undefined,
      required: true,
    })
    expect(resolveTurnstileClientConfiguration('invalid', false)).toEqual({
      state: 'unavailable',
      siteKey: undefined,
      required: true,
    })
  })

  it('uses an explicit production key and the official development adapter', () => {
    expect(resolveTurnstileClientConfiguration('configured-turnstile-site-key', false)).toEqual({
      state: 'ready',
      siteKey: 'configured-turnstile-site-key',
      required: true,
    })
    expect(resolveTurnstileClientConfiguration(undefined, true)).toEqual({
      state: 'ready',
      siteKey: TURNSTILE_TEST_SITE_KEY,
      required: true,
    })
    expect(resolveTurnstileClientConfiguration('', true)).toEqual({
      state: 'local-bypass',
      siteKey: undefined,
      required: false,
    })
  })
})
