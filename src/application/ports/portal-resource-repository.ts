import type { EventId, PortalResource } from '../../domain'

export interface PortalResourceRepository {
  listByEvent(eventId: EventId): Promise<readonly PortalResource[]>
  findById(eventId: EventId, id: string): Promise<PortalResource | null>
  insert(resource: PortalResource): Promise<void>
  update(resource: PortalResource): Promise<'updated' | 'not-found'>
  delete(eventId: EventId, id: string): Promise<'deleted' | 'not-found'>
  reorder(eventId: EventId, ids: readonly string[], updatedAt: string): Promise<boolean>
}
