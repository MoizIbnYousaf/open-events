import type {
  AnswerMap,
  ContactId,
  EventId,
  FormId,
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
   * already-completed task keeps the first `completedAt` and `response`
   * (idempotent). `response` is persisted only by the completing write of a
   * form task. Returns null when the task does not exist in the event.
   */
  markCompleted(
    eventId: EventId,
    id: SpeakerTaskId,
    completedAt: UtcInstant,
    response?: AnswerMap,
  ): Promise<SpeakerTask | null>
  /**
   * Inserts one organizer-assigned form task. Re-assigning the same form to
   * the same speaker on the same submission returns the existing row instead
   * of a second task (idempotent by the partial unique form index).
   */
  createFormTask(task: SpeakerTask): Promise<SpeakerTask>
  findFormTask(
    eventId: EventId,
    submissionId: SubmissionId,
    contactId: ContactId,
    formId: FormId,
  ): Promise<SpeakerTask | null>
}
