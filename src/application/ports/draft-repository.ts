import type { ContactId, DraftId, EventId, ProposalDraft, UtcInstant } from '../../domain'

export interface DraftRepository {
  findById(id: DraftId): Promise<ProposalDraft | null>
  listByOwner(eventId: EventId, ownerContactId: ContactId): Promise<readonly ProposalDraft[]>
  /**
   * Optimistic upsert: `expectedUpdatedAt` is the row's `updated_at` as read by
   * the service (null when creating a new draft). Returns false when the row
   * changed since the read (or the id already exists on create) so stale
   * writes surface as a conflict instead of silently clobbering.
   */
  save(draft: ProposalDraft, expectedUpdatedAt: UtcInstant | null): Promise<boolean>
}
