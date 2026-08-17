import { beforeEach, describe, expect, it } from 'vitest'

import {
  claimTourLease,
  ownsTourLease,
  releaseTourLease,
  renewTourLease,
  TOUR_LEASE_KEY,
  TOUR_LEASE_TTL_MS,
} from '../../../src/app/features/tour/tour-lease'

beforeEach(() => window.localStorage.clear())

describe('tour active-tab lease', () => {
  it('allows one tab, rejects a live competitor, and permits takeover after expiry', () => {
    expect(claimTourLease('tab-a', 1_000)).toBe(true)
    expect(claimTourLease('tab-b', 1_001)).toBe(false)
    expect(ownsTourLease('tab-b', 1_001)).toBe(false)
    expect(claimTourLease('tab-b', 1_000 + TOUR_LEASE_TTL_MS + 1)).toBe(true)
    expect(ownsTourLease('tab-a', 1_000 + TOUR_LEASE_TTL_MS + 1)).toBe(false)
  })

  it('renews only the owner and never lets an old tab release the new lease', () => {
    expect(claimTourLease('tab-a', 1_000)).toBe(true)
    expect(renewTourLease('tab-a', 2_000)).toBe(true)
    const renewed = JSON.parse(window.localStorage.getItem(TOUR_LEASE_KEY) ?? '{}') as {
      expiresAt?: number
    }
    expect(renewed.expiresAt).toBe(2_000 + TOUR_LEASE_TTL_MS)

    expect(claimTourLease('tab-b', 2_000 + TOUR_LEASE_TTL_MS + 1)).toBe(true)
    releaseTourLease('tab-a')
    expect(ownsTourLease('tab-a', 2_000 + TOUR_LEASE_TTL_MS + 1)).toBe(false)
    releaseTourLease('tab-b')
    expect(window.localStorage.getItem(TOUR_LEASE_KEY)).toBeNull()
  })
})
