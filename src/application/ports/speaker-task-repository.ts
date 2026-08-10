import type {
  ContactId,
  EventId,
  SpeakerTask,
  SpeakerTaskId,
  SubmissionAcceptance,
  SubmissionId,
  UtcInstant,
} from '../../domain'

/**
 * Reads over the onboarding checklist plus the single completion write. Every
 * read is event-scoped: a caller can never reach another event's tasks by id
 * alone, because completion is also gated on the event.
 */
export interface SpeakerTaskRepository {
  findById(id: SpeakerTaskId): Promise<SpeakerTask | null>
  listByEvent(eventId: EventId): Promise<readonly SpeakerTask[]>
  listByContact(eventId: EventId, contactId: ContactId): Promise<readonly SpeakerTask[]>
  listBySubmission(eventId: EventId, submissionId: SubmissionId): Promise<readonly SpeakerTask[]>
  findAcceptance(eventId: EventId, submissionId: SubmissionId): Promise<SubmissionAcceptance | null>
  listAcceptancesByEvent(eventId: EventId): Promise<readonly SubmissionAcceptance[]>
  /**
   * Completes a pending task and returns the resulting row; completing an
   * already-completed task keeps the first `completedAt` (idempotent). Returns
   * null when the task does not exist in the event.
   */
  markCompleted(
    eventId: EventId,
    id: SpeakerTaskId,
    completedAt: UtcInstant,
  ): Promise<SpeakerTask | null>
}
