import type { ContactId, EventId, SubmissionId, TaxonomyItemId, UtcInstant } from '../../domain'
import type { AgendaSessionAssignment, AgendaSessionStatus } from '../../domain/agenda'

/**
 * One persisted agenda session: the accepted submission, its placement in the
 * committed room/track vocabulary, the embedded (day, start, end) slot, and the
 * speakers the session carries. `roomId`/`position` are null exactly while the
 * session is `unassigned`.
 */
export interface AgendaSessionRecord {
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly trackId: TaxonomyItemId | null
  readonly roomId: TaxonomyItemId | null
  readonly day: string
  readonly start: UtcInstant
  readonly end: UtcInstant
  readonly position: number | null
  readonly status: AgendaSessionStatus
  readonly assignment: AgendaSessionAssignment
  readonly speakerIds: readonly ContactId[]
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
}

/**
 * Persistence port for the agenda. Every read is event-scoped, so a caller can
 * never reach another event's sessions by submission id alone.
 */
export interface AgendaRepository {
  /** Deterministic order: day, start, position, room, submission id. */
  listByEvent(eventId: EventId): Promise<readonly AgendaSessionRecord[]>
  findBySubmission(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<AgendaSessionRecord | null>
  /** Atomic upsert of the session row plus a full replace of its speakers. */
  saveSession(session: AgendaSessionRecord): Promise<void>
}
