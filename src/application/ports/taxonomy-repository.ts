import type { EventId, TaxonomyItem } from '../../domain'

export interface TaxonomyRepository {
  listByEvent(eventId: EventId): Promise<readonly TaxonomyItem[]>
  /** Atomically replaces the event's full taxonomy item set. */
  replaceForEvent(eventId: EventId, items: readonly TaxonomyItem[]): Promise<void>
}
