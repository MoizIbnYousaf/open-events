import type { CfpForm, EventId, FormId, FormSlug } from '../../domain'

export interface FormRepository {
  findById(id: FormId): Promise<CfpForm | null>
  findByEventAndSlug(eventId: EventId, slug: FormSlug): Promise<CfpForm | null>
  listByEvent(eventId: EventId): Promise<readonly CfpForm[]>
}
