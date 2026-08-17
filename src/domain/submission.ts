import type { AnswerMap } from './answers.ts'
import type { ContactId, ContactRole } from './contact.ts'
import type { DraftId } from './draft.ts'
import type { EventId, UtcInstant } from './event.ts'
import type { VersionId } from './form-version.ts'
import type { RoutingOutcome } from './rules.ts'

export type SubmissionId = string

export const SUBMISSION_STATUSES = ['pending'] as const

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]
export const SUBMISSION_SOURCES = ['cfp', 'direct'] as const
export type SubmissionSource = (typeof SUBMISSION_SOURCES)[number]

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
  readonly source: SubmissionSource
  readonly title: string
  readonly answers: AnswerMap
  readonly contentHash: string
  readonly routing: RoutingOutcome | null
  readonly createdAt: UtcInstant
  readonly submittedAt: UtcInstant
}

/**
 * The two verdicts a programme committee can reach. `pending` is deliberately
 * absent: an undecided proposal has no decision row at all, so 'not decided
 * yet' is the absence of a record rather than a third stored value that every
 * write path would have to keep honest.
 */
export const SUBMISSION_DECISION_OUTCOMES = ['accepted', 'rejected'] as const

export type SubmissionDecisionOutcome = (typeof SUBMISSION_DECISION_OUTCOMES)[number]

/**
 * What a surface SHOWS, as opposed to what the table can store: the recorded
 * verdict, or 'pending' when there is not one yet.
 *
 * The two vocabularies are deliberately different sizes.
 * `SUBMISSION_DECISION_OUTCOMES` is what an organizer can RECORD, and it
 * matches the migration's CHECK constraint exactly, so 'pending' can never be
 * written as if it were a verdict somebody reached. This type is what a reader
 * is TOLD, and it needs a third word because "nobody has decided yet" is a real
 * answer a speaker is owed — not an absence to be rendered as a blank.
 *
 * 'pending' rather than null, so there is ONE spelling of undecided across the
 * wire, the cache and every client. Null invited each surface to invent its own
 * handling of a missing field, and two of them disagreed.
 */
export const SUBMISSION_OUTCOMES = ['pending', 'accepted', 'rejected'] as const

export type SubmissionOutcome = (typeof SUBMISSION_OUTCOMES)[number]

export function isSubmissionDecisionOutcome(value: unknown): value is SubmissionDecisionOutcome {
  return (
    typeof value === 'string' && (SUBMISSION_DECISION_OUTCOMES as readonly string[]).includes(value)
  )
}

/**
 * One recorded programme decision — one entry in an append-only trail, not the
 * mutable current state. `sequence` numbers the verdicts on a submission from
 * 1, and the highest one is the decision that stands.
 *
 * `decidedBy` is the acting ROLE, not a person: an organizer session carries no
 * contact identity, so a name-shaped audit field here would be invented rather
 * than recorded.
 */
export interface SubmissionDecision {
  readonly id: string
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly sequence: number
  readonly outcome: SubmissionDecisionOutcome
  readonly decidedBy: string
  readonly decidedAt: UtcInstant
}

export interface SubmissionContributor {
  readonly submissionId: SubmissionId
  readonly eventId: EventId
  readonly contactId: ContactId
  readonly role: ContactRole
  readonly position: number
}
