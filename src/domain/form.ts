import type { EventId, UtcInstant } from './event.ts'
import type { VersionId } from './form-version.ts'

export type FormId = string
export type FormSlug = string

export const FORM_STATUSES = ['draft', 'published'] as const

export type FormStatus = (typeof FORM_STATUSES)[number]
export const FORM_PURPOSES = ['public', 'direct'] as const
export type FormPurpose = (typeof FORM_PURPOSES)[number]

/**
 * Submission capacity. `null` means unlimited; any non-null value is a positive
 * integer (enforced by the `isPositiveCap` invariant).
 */
export type Cap = number

/**
 * CFP open/close and capacity settings. `opens_at`/`closes_at` are nullable UTC
 * instants (both-null means always open; when both are set, closes > opens).
 */
export interface FormLimits {
  readonly opensAt: UtcInstant | null
  readonly closesAt: UtcInstant | null
  readonly totalCap: Cap | null
  readonly perIdentityLimit: Cap | null
}

/** Call-for-papers form aggregate. */
export interface CfpForm {
  readonly id: FormId
  readonly eventId: EventId
  readonly slug: FormSlug
  readonly status: FormStatus
  readonly purpose: FormPurpose
  readonly publishedVersionId: VersionId | null
  readonly limits: FormLimits
}
