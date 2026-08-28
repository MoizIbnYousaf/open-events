import type { EventId } from '../../domain'
import type {
  SubmissionDeskChoiceField,
  SubmissionDeskRecord,
  SubmissionDeskSource,
} from '../dtos/submission-desk.dto'

export type { SubmissionDeskChoiceField, SubmissionDeskRecord }

/** Event-scoped, bounded-query read model for the organizer submission desk. */
export interface SubmissionDeskRepository {
  listByEvent(eventId: EventId): Promise<SubmissionDeskSource>
}
