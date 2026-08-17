export const TOUR_LEASE_KEY = 'open-events:tour-lease'
export const TOUR_TAB_ID_KEY = 'open-events:tour-tab-id'
export const TOUR_LEASE_TTL_MS = 15_000

interface TourLease {
  readonly tabId: string
  readonly expiresAt: number
}

function readLease(): TourLease | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TOUR_LEASE_KEY) ?? 'null') as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('tabId' in parsed) ||
      !('expiresAt' in parsed) ||
      typeof parsed.tabId !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null
    }
    return { tabId: parsed.tabId, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

function writeLease(tabId: string, now: number): void {
  window.localStorage.setItem(
    TOUR_LEASE_KEY,
    JSON.stringify({ tabId, expiresAt: now + TOUR_LEASE_TTL_MS }),
  )
}

export function tourTabId(): string {
  try {
    const existing = window.sessionStorage.getItem(TOUR_TAB_ID_KEY)
    if (existing !== null) return existing
    const created = crypto.randomUUID()
    window.sessionStorage.setItem(TOUR_TAB_ID_KEY, created)
    return created
  } catch {
    return crypto.randomUUID()
  }
}

/** Claims an expired, absent, or already-owned lease. Storage denial stays usable in one tab. */
export function claimTourLease(tabId: string, now = Date.now()): boolean {
  try {
    const current = readLease()
    if (current !== null && current.tabId !== tabId && current.expiresAt > now) return false
    writeLease(tabId, now)
    return true
  } catch {
    return true
  }
}

export function renewTourLease(tabId: string, now = Date.now()): boolean {
  return claimTourLease(tabId, now)
}

export function ownsTourLease(tabId: string, now = Date.now()): boolean {
  const current = readLease()
  return current === null || current.expiresAt <= now || current.tabId === tabId
}

export function releaseTourLease(tabId: string): void {
  try {
    if (readLease()?.tabId === tabId) window.localStorage.removeItem(TOUR_LEASE_KEY)
  } catch {
    // Storage-denied browsers have no cross-tab coordination to release.
  }
}
