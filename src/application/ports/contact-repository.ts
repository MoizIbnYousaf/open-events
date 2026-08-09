import type { Contact, ContactId } from '../../domain'

export interface ContactRepository {
  findById(id: ContactId): Promise<Contact | null>
  /** `email` must already be normalized (see `normalizeEmail`). */
  findByEmail(email: string): Promise<Contact | null>
}
