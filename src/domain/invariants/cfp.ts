import type { UtcInstant } from '../event.ts'
import type { CfpForm } from '../form.ts'
import type { Cap, FormLimits } from '../form.ts'
import type { VersionId } from '../form-version.ts'

export type SubmitGateReason =
  'open' | 'not_open_yet' | 'closed' | 'total_cap_reached' | 'identity_limit_reached'

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

/**
 * What a call's window means right now, named rather than left as a date for
 * every reader to judge for itself.
 *
 * The public portal, the submit gate and the edit gate all have to agree about
 * whether a call is open, and a date plus a clock is not agreement — it is three
 * chances to disagree. `submissionState` is the one verdict they all read.
 */
export type SubmissionState = 'not-yet-open' | 'open' | 'closed'

export function submissionStateOf(limits: FormLimits, now: UtcInstant): SubmissionState {
  const nowMs = Date.parse(now)
  if (limits.opensAt !== null && nowMs < Date.parse(limits.opensAt)) return 'not-yet-open'
  if (limits.closesAt !== null && nowMs >= Date.parse(limits.closesAt)) return 'closed'
  return 'open'
}

/**
 * A submitted proposal may be revised only while the call is open. The deadline
 * is the point after which the programme reads what it has, so an edit landing a
 * minute later would change a proposal underneath a committee already reviewing
 * it.
 */
export function isSubmissionEditable(limits: FormLimits, now: UtcInstant): boolean {
  return submissionStateOf(limits, now) === 'open'
}
