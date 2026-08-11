import type {
  ContactId,
  EventId,
  SpeakerTask,
  SubmissionAcceptance,
  SubmissionId,
  UtcInstant,
} from '../../domain'

/**
 * The agenda session acceptance materialises: an `unassigned` draft carrying
 * the placeholder slot and every contributor. Track, room and position stay
 * unset — the organizer supplies them when placing the session.
 */
export interface AcceptSessionDraft {
  /** `YYYY-MM-DD`. */
  readonly day: string
  readonly start: UtcInstant
  readonly end: UtcInstant
  readonly speakerContactIds: readonly ContactId[]
}

export interface AcceptBatchInput {
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly acceptedAt: UtcInstant
  readonly tasks: readonly SpeakerTask[]
  readonly session: AcceptSessionDraft
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
 * Atomic acceptance: the acceptance row, the whole onboarding checklist and
 * the submission's agenda session land together or not at all. Integrity
 * failures reject and write nothing.
 */
export interface AcceptUnitOfWork {
  execute(input: AcceptBatchInput): Promise<AcceptBatchResult>
}
