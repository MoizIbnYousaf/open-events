import type { UtcInstant } from '../event.ts'
import type { CfpForm } from '../form.ts'
import type { Cap, FormLimits } from '../form.ts'
import type { VersionId } from '../form-version.ts'

export const SUBMIT_GATE_REASONS = [
  'open',
  'not_open_yet',
  'closed',
  'total_cap_reached',
  'identity_limit_reached',
] as const

export type SubmitGateReason = (typeof SUBMIT_GATE_REASONS)[number]

export interface SubmitGate {
  readonly allowed: boolean
  readonly reason: SubmitGateReason
}

export function isCfpOpen(limits: FormLimits, now: UtcInstant): boolean {
  const nowMs = Date.parse(now)
  if (limits.opensAt !== null && nowMs < Date.parse(limits.opensAt)) return false
  if (limits.closesAt !== null && nowMs >= Date.parse(limits.closesAt)) return false
  return true
}

export function isTotalCapReached(totalCap: Cap | null, count: number): boolean {
  return totalCap !== null && count >= totalCap
}

export function isPerIdentityLimitReached(perIdentityLimit: Cap | null, count: number): boolean {
  return perIdentityLimit !== null && count >= perIdentityLimit
}

/**
 * Server-side submit gate. All predicates are re-evaluated inside the submit
 * transaction; the client's visibility/cap state is never trusted.
 */
export function evaluateSubmitGate(
  limits: FormLimits,
  now: UtcInstant,
  totalCount: number,
  identityCount: number,
): SubmitGate {
  const nowMs = Date.parse(now)
  if (limits.opensAt !== null && nowMs < Date.parse(limits.opensAt))
    return { allowed: false, reason: 'not_open_yet' }
  if (limits.closesAt !== null && nowMs >= Date.parse(limits.closesAt))
    return { allowed: false, reason: 'closed' }
  if (isTotalCapReached(limits.totalCap, totalCount))
    return { allowed: false, reason: 'total_cap_reached' }
  if (isPerIdentityLimitReached(limits.perIdentityLimit, identityCount)) {
    return { allowed: false, reason: 'identity_limit_reached' }
  }
  return { allowed: true, reason: 'open' }
}

/**
 * Submit-gate version binding: only submissions against the form's CURRENTLY
 * published version are accepted. Any older/newer version (or a form that is
 * not published) is a deterministic `closed` outcome.
 */
export function isFormAcceptingVersion(form: CfpForm, formVersionId: VersionId): boolean {
  return form.status === 'published' && form.publishedVersionId === formVersionId
}

/**
 * Full server-side submit gate: version binding AND open/close/cap predicates.
 * The M2B adapter evaluates this inside the submit transaction against the
 * re-read form row.
 */
export function evaluateFormSubmitGate(
  form: CfpForm,
  formVersionId: VersionId,
  now: UtcInstant,
  totalCount: number,
  identityCount: number,
): SubmitGate {
  if (!isFormAcceptingVersion(form, formVersionId)) return { allowed: false, reason: 'closed' }
  return evaluateSubmitGate(form.limits, now, totalCount, identityCount)
}
