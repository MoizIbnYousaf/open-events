import type { CapturedMessage, CapturedMessageKind, EventId, SubmissionId } from '../../domain'

/**
 * Append-only captured-message log. Implementations MUST never update or
 * delete a stored row: `save` is the single write, and the unique
 * (submission, kind, recipient) triple makes a repeat organizer send a
 * conflict the service resolves by returning the already-stored winner.
 */
export interface CapturedMessageRepository {
  /** Dev/local endpoint only: lists captured messages for one normalized email. */
  listByEmail(email: string): Promise<readonly CapturedMessage[]>
  /** Appends one message; rejects a duplicate (submission, kind, recipient). */
  save(message: CapturedMessage): Promise<void>
  /** The stored row for one (submission, kind, normalized recipient), if any. */
  findBySubmissionKindEmail(
    submissionId: SubmissionId,
    kind: CapturedMessageKind,
    toEmail: string,
  ): Promise<CapturedMessage | null>
  /** The purpose-bound replacement, excluding immutable pre-0026 static captures. */
  findAccessBoundBySubmissionKindEmail(
    submissionId: SubmissionId,
    kind: CapturedMessageKind,
    toEmail: string,
  ): Promise<CapturedMessage | null>
  /**
   * The whole event's outbound log, newest first, capped.
   *
   * Capped rather than complete: an organizer opening a log wants the recent
   * traffic, and an event that has run for a year would otherwise send its
   * entire correspondence over the wire to render one screen.
   */
  listByEvent(eventId: EventId, limit: number): Promise<readonly CapturedMessage[]>
  /** Immutable send history for one submission, all kinds, oldest first. */
  listBySubmissionId(submissionId: SubmissionId): Promise<readonly CapturedMessage[]>
}
