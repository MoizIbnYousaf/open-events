import type { CapturedMessage, SubmissionId } from '../../domain'

/**
 * Append-only captured-message log. Implementations MUST never update or
 * delete a stored row: `save` is the single write, and the acceptance
 * `submissionId` is unique, so a repeat acceptance insert is a conflict the
 * service resolves by returning the already-stored row.
 */
export interface CapturedMessageRepository {
  /** Dev/local endpoint only: lists captured messages for one normalized email. */
  listByEmail(email: string): Promise<readonly CapturedMessage[]>
  /** Appends one message; rejects a second message for the same submission. */
  save(message: CapturedMessage): Promise<void>
  findBySubmissionId(submissionId: SubmissionId): Promise<CapturedMessage | null>
  /** Immutable send history for one submission, oldest first. */
  listBySubmissionId(submissionId: SubmissionId): Promise<readonly CapturedMessage[]>
}
