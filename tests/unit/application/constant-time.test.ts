import { describe, expect, it } from 'vitest'

import { constantTimeSecretEqual } from '../../../src/application'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

// jsdom's Crypto lacks crypto.subtle; these specs run with Node's WebCrypto
// stubbed in — never a no-stub jsdom claim.
installNodeWebCrypto()

describe('constantTimeSecretEqual', () => {
  it('returns true for equal secrets', async () => {
    expect(await constantTimeSecretEqual('secret', 'secret')).toBe(true)
    expect(await constantTimeSecretEqual('demo-conf-local-token', 'demo-conf-local-token')).toBe(
      true,
    )
  })

  it('returns false when a single character differs', async () => {
    expect(await constantTimeSecretEqual('secret', 'secreT')).toBe(false)
    expect(await constantTimeSecretEqual('abc', 'abd')).toBe(false)
  })

  it('returns false for identical prefixes with a differing suffix', async () => {
    expect(await constantTimeSecretEqual('prefix-common-token', 'prefix-common-tokn')).toBe(false)
  })

  it('returns false for different lengths', async () => {
    expect(await constantTimeSecretEqual('short', 'longer-secret')).toBe(false)
    expect(await constantTimeSecretEqual('', 'x')).toBe(false)
  })

  it('compares equal non-ASCII secrets as true', async () => {
    expect(await constantTimeSecretEqual('café', 'café')).toBe(true)
    expect(await constantTimeSecretEqual('sécret-🔑', 'sécret-🔑')).toBe(true)
  })

  it('compares a one-code-point Unicode difference as false', async () => {
    expect(await constantTimeSecretEqual('café', 'cafè')).toBe(false)
    // Composed U+00E9 vs decomposed e + U+0301: different UTF-8 bytes.
    expect(await constantTimeSecretEqual('café', 'cafe\u0301')).toBe(false)
  })

  it('returns true for empty vs empty', async () => {
    expect(await constantTimeSecretEqual('', '')).toBe(true)
  })

  it('is call-order independent', async () => {
    const pairs = [
      ['secret', 'secret'],
      ['café', 'café'],
      ['', ''],
      ['secret', 'secreT'],
      ['prefix-token', 'prefix-tokne'],
      ['a', 'longer'],
    ] as const

    for (const [a, b] of pairs) {
      expect(await constantTimeSecretEqual(a, b)).toBe(await constantTimeSecretEqual(b, a))
    }
  })
})
