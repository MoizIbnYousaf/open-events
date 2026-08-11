import type { Contact, ContactId } from '../../domain'

export interface ContactRepository {
  findById(id: ContactId): Promise<Contact | null>
  /** `email` must already be normalized (see `normalizeEmail`). */
  findByEmail(email: string): Promise<Contact | null>
  /**
   * Persists the speaker-editable profile fields for one contact. Identity
   * fields (id, email, createdAt) are never touched by this write.
   */
  updateProfile(
    id: ContactId,
    fields: { readonly name: string; readonly bio: string | null },
  ): Promise<void>
}
