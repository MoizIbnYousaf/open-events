import type { AnswerMap } from './answers.ts'
import type { ContactId, ContactRole } from './contact.ts'
import type { DraftId } from './draft.ts'
import type { EventId, UtcInstant } from './event.ts'
import type { VersionId } from './form-version.ts'
import type { RoutingOutcome } from './rules.ts'

export type SubmissionId = string

export const SUBMISSION_STATUSES = ['pending'] as const

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

/**
 * Persisted proposal submission. `originDraftId` is the idempotency key: a
 * retry of the same draft returns the existing submission instead of creating
 * a second record.
 */
export interface ProposalSubmission {
  readonly id: SubmissionId
  readonly eventId: EventId
  readonly ownerContactId: ContactId
  readonly formVersionId: VersionId
  readonly originDraftId: DraftId
  readonly status: SubmissionStatus
  readonly title: string
  readonly answers: AnswerMap
  readonly contentHash: string
  readonly routing: RoutingOutcome | null
  readonly createdAt: UtcInstant
  readonly submittedAt: UtcInstant
}

export interface SubmissionContributor {
  readonly submissionId: SubmissionId
  readonly eventId: EventId
  readonly contactId: ContactId
  readonly role: ContactRole
  readonly position: number
}
