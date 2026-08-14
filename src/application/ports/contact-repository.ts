import type { EventId } from '../../domain/event'
import type { Contact, ContactId, UtcInstant } from '../../domain'

/**
 * One person on an event's programme, with the numbers an organizer asks about
 * them. Assembled in one statement rather than a query per speaker: a roster is
 * a list, and a list that costs a round trip per row stops loading long before
 * the programme stops growing.
 */
export interface SpeakerRosterRow {
  readonly contactId: ContactId
  readonly email: string
  readonly name: string
  readonly bio: string | null
  /** Proposals they are on, in any capacity. */
  readonly proposalCount: number
  /** Sessions they are scheduled to present. */
  readonly sessionCount: number
  /** Onboarding tasks assigned to them, and how many they have finished. */
  readonly taskCount: number
  readonly taskCompletedCount: number
  /** Whether they have uploaded a headshot — a thing organizers chase. */
  readonly hasHeadshot: boolean
  readonly jobTitle: string
  readonly company: string
  readonly travelNotes: string
  readonly workflowStatus: string
}

export interface ContactRepository {
  /** Everyone on this event's programme, alphabetically, with their workload. */
  listSpeakersByEvent(eventId: EventId): Promise<readonly SpeakerRosterRow[]>
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
  upsertSpeakerProfile(input: {
    readonly eventId: EventId
    readonly contactId: ContactId
    readonly jobTitle: string
    readonly company: string
    readonly travelNotes: string
    readonly workflowStatus: string
    readonly createdAt: UtcInstant
    readonly updatedAt: UtcInstant
  }): Promise<void>
}
