import type { Event } from '../../domain'
import type { EventRepository } from './event-repository'

/** Event read/write port for the admin configuration surface (M2). */
export interface EventConfigRepository extends EventRepository {
  save(event: Event): Promise<void>
}
