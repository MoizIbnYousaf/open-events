import type {
  EventId,
  SpeakerTask,
  SubmissionAcceptance,
  SubmissionId,
  UtcInstant,
} from '../../domain'

export interface AcceptBatchInput {
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly acceptedAt: UtcInstant
  readonly tasks: readonly SpeakerTask[]
}

/**
 * `not-found` is the zero-row effect of the submission gate, never an
 * exception; `already-accepted` is the idempotent retry. Both carry the tasks
 * that exist after the batch so callers never issue a second read.
 */
export interface AcceptBatchResult {
  readonly outcome: 'accepted' | 'already-accepted' | 'not-found'
  readonly acceptance: SubmissionAcceptance | null
  readonly tasks: readonly SpeakerTask[]
}

/**
 * Atomic acceptance: the acceptance row and the whole onboarding checklist
 * land together or not at all. Integrity failures reject and write nothing.
 */
export interface AcceptUnitOfWork {
  execute(input: AcceptBatchInput): Promise<AcceptBatchResult>
}
