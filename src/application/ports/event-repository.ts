import type { Event, EventId, EventSlug } from '../../domain'

/**
 * Persistence port for events.
 *
 * Implemented by the D1-backed adapter in `src/db`; the application and domain
 * layers only ever depend on this interface.
 */
export interface EventRepository {
  findById(id: EventId): Promise<Event | null>
  findBySlug(slug: EventSlug): Promise<Event | null>
}
