import type { EventId } from '../../domain'
import type { SubmissionViewRecord } from '../dtos/submission-view.dto'

export type { SubmissionViewRecord }

export interface SubmissionViewRepository {
  listByEvent(eventId: EventId): Promise<readonly SubmissionViewRecord[]>
  create(view: SubmissionViewRecord): Promise<'created' | 'duplicate'>
  delete(eventId: EventId, id: string): Promise<'deleted' | 'not-found'>
}
