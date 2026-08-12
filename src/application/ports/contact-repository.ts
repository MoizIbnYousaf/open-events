import type { Contact, ContactId, UtcInstant } from '../../domain'

export interface ContactRepository {
  findById(id: ContactId): Promise<Contact | null>
  /** `email` must already be normalized (see `normalizeEmail`). */
  findByEmail(email: string): Promise<Contact | null>
  /**
   * Returns the contact for this email, creating it when nobody has ever used
   * it. Email is the identity key, so an organizer inviting someone who has
   * never signed in and that person signing in later converge on ONE row; the
   * insert is conflict-tolerant for the same reason the sign-in path's is.
   *
   * Never touches an existing row: a person's own name is theirs to change, not
   * something a later invite overwrites with whatever the organizer typed.
   */
  ensureByEmail(input: {
    readonly id: ContactId
    readonly email: string
    readonly name: string
    readonly createdAt: UtcInstant
  }): Promise<Contact>
  /**
   * Persists the speaker-editable profile fields for one contact. Identity
   * fields (id, email, createdAt) are never touched by this write.
   */
  updateProfile(
    id: ContactId,
    fields: { readonly name: string; readonly bio: string | null },
  ): Promise<void>
}
