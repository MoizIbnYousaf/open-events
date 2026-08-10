import type { Cap, FormLimits } from '../form.ts'
import { isValidUtcInstant } from './time.ts'

export type FormLimitIssueCode = 'invalid_cap' | 'invalid_utc_instant' | 'invalid_date_range'

export interface FormLimitIssue {
  readonly code: FormLimitIssueCode
  readonly message: string
}

/** NULL = unlimited; non-null caps must be positive integers. */
export function isPositiveCap(cap: Cap): boolean {
  return Number.isInteger(cap) && cap > 0
}

export function validateFormLimits(limits: FormLimits): readonly FormLimitIssue[] {
  const issues: FormLimitIssue[] = []
  if (limits.totalCap !== null && !isPositiveCap(limits.totalCap)) {
    issues.push({
      code: 'invalid_cap',
      message: 'total_cap must be a positive integer or null (unlimited)',
    })
  }
  if (limits.perIdentityLimit !== null && !isPositiveCap(limits.perIdentityLimit)) {
    issues.push({
      code: 'invalid_cap',
      message: 'per_identity_limit must be a positive integer or null (unlimited)',
    })
  }
  if (limits.opensAt !== null && !isValidUtcInstant(limits.opensAt)) {
    issues.push({
      code: 'invalid_utc_instant',
      message: `'${limits.opensAt}' is not a canonical UTC instant`,
    })
  }
  if (limits.closesAt !== null && !isValidUtcInstant(limits.closesAt)) {
    issues.push({
      code: 'invalid_utc_instant',
      message: `'${limits.closesAt}' is not a canonical UTC instant`,
    })
  }
  if (
    limits.opensAt !== null &&
    limits.closesAt !== null &&
    isValidUtcInstant(limits.opensAt) &&
    isValidUtcInstant(limits.closesAt) &&
    Date.parse(limits.closesAt) <= Date.parse(limits.opensAt)
  ) {
    issues.push({
      code: 'invalid_date_range',
      message: 'closes_at must be after opens_at when both are set',
    })
  }
  return issues
}
