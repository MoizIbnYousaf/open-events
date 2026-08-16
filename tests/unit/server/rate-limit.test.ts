import { describe, expect, it } from 'vitest'

import {
  EDGE_LIMIT_POLICIES,
  keyedLimitKey,
  normalizeClientAddress,
} from '../../../src/server/rate-limit'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

describe('privacy-preserving rate-limit keys', () => {
  it('normalizes IPv4 and collapses IPv6 sources to a /64', () => {
    expect(normalizeClientAddress('203.0.113.9')).toBe('203.0.113.9')
    expect(normalizeClientAddress('2001:db8:abcd:0012:1111:2222:3333:4444')).toBe(
      '2001:db8:abcd:12::/64',
    )
    expect(normalizeClientAddress('2001:db8:abcd:12::99')).toBe('2001:db8:abcd:12::/64')
    expect(normalizeClientAddress('not-an-address')).toBe('unknown')
  })

  it('derives stable purpose-bound keys without retaining recipient or address text', async () => {
    const first = await keyedLimitKey(
      'unit-test-secret-with-enough-entropy',
      'start-recipient',
      'Speaker@Example.test',
    )
    const again = await keyedLimitKey(
      'unit-test-secret-with-enough-entropy',
      'start-recipient',
      'Speaker@Example.test',
    )
    const otherPurpose = await keyedLimitKey(
      'unit-test-secret-with-enough-entropy',
      'redeem-token',
      'Speaker@Example.test',
    )

    expect(first).toBe(again)
    expect(first).not.toBe(otherPurpose)
    expect(first).toMatch(/^v1:start-recipient:[0-9a-f]{64}$/)
    expect(first).not.toContain('Speaker')
    expect(first).not.toContain('Example')
  })

  it('commits the exact product windows separately from the 60-second edge approximation', () => {
    expect(EDGE_LIMIT_POLICIES.startRecipient).toMatchObject({
      edgeLimit: 3,
      edgePeriodSeconds: 60,
      productLimit: 3,
      productWindowSeconds: 600,
    })
    expect(EDGE_LIMIT_POLICIES.startSource).toMatchObject({
      edgeLimit: 10,
      edgePeriodSeconds: 60,
      productWindowSeconds: 600,
    })
    expect(EDGE_LIMIT_POLICIES.adminLogin).toMatchObject({
      edgeLimit: 5,
      productWindowSeconds: 900,
    })
    expect(EDGE_LIMIT_POLICIES.redeemSource).toMatchObject({
      edgeLimit: 20,
      productWindowSeconds: 300,
    })
    expect(EDGE_LIMIT_POLICIES.redeemToken).toMatchObject({
      edgeLimit: 5,
      productWindowSeconds: 300,
    })
    expect(EDGE_LIMIT_POLICIES.organizerSend).toMatchObject({
      edgeLimit: 30,
      productWindowSeconds: 3600,
    })
  })
})
