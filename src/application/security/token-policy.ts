import type { Session, SubmitterToken, UtcInstant } from '../../domain'

export const MIN_TTL_MS = 1
export const MAX_ORGANIZER_SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const MAX_SUBMITTER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_SUBMITTER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function canUseLegacyCapabilityRow(
  row: { readonly createdAt: UtcInstant },
  now: UtcInstant,
  lastLegacyWriterCutoff: UtcInstant | null,
  maximumLifetimeMs: number,
): boolean {
  if (lastLegacyWriterCutoff === null || maximumLifetimeMs < 1) return false
  const createdAtMs = Date.parse(row.createdAt)
  const nowMs = Date.parse(now)
  const cutoffMs = Date.parse(lastLegacyWriterCutoff)
  if (![createdAtMs, nowMs, cutoffMs].every(Number.isFinite)) return false
  return createdAtMs <= cutoffMs && createdAtMs <= nowMs && nowMs <= cutoffMs + maximumLifetimeMs
}

/** TTLs must be positive integers, bounded per session/token kind. */
export function isValidTtl(ttlMs: number, maxMs: number): boolean {
  return Number.isInteger(ttlMs) && ttlMs >= MIN_TTL_MS && ttlMs <= maxMs
}

export function assertValidTtl(ttlMs: number, maxMs: number): void {
  if (!isValidTtl(ttlMs, maxMs)) {
    throw new RangeError(
      `TTL must be an integer between ${MIN_TTL_MS} and ${maxMs} ms (got ${ttlMs})`,
    )
  }
}

export function isExpired(expiresAt: UtcInstant, now: UtcInstant): boolean {
  return Date.parse(now) >= Date.parse(expiresAt)
}

export function isConsumed(consumedAt: UtcInstant | null): boolean {
  return consumedAt !== null
}

export function isTokenRedeemable(token: SubmitterToken, now: UtcInstant): boolean {
  return !isExpired(token.expiresAt, now) && !isConsumed(token.consumedAt)
}

export function isSessionValid(session: Session, now: UtcInstant): boolean {
  return !isExpired(session.expiresAt, now) && !isConsumed(session.consumedAt)
}
