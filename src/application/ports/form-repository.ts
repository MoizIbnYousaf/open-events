import type { CfpForm, EventId, FormId, FormSlug, UtcInstant } from '../../domain'

export interface FormRepository {
  findById(id: FormId): Promise<CfpForm | null>
  findByEventAndSlug(eventId: EventId, slug: FormSlug): Promise<CfpForm | null>
  listByEvent(eventId: EventId): Promise<readonly CfpForm[]>
  /**
   * Replaces the submission window. Scoped by BOTH event and form id, so a form
   * id belonging to another event cannot be moved by naming this event's slug in
   * the path — the update simply matches no row and reports it.
   */
  updateWindow(input: {
    readonly eventId: EventId
    readonly formId: FormId
    readonly opensAt: UtcInstant | null
    readonly closesAt: UtcInstant | null
  }): Promise<'updated' | 'not-found'>
}
