import type { OrganizerActor } from '../actors'
import type { EventId } from '../../domain/event'
import type { ContactId } from '../../domain/contact'
import type { ContactRepository } from '../ports/contact-repository'

/**
 * One person on the programme, as the organizer's roster shows them.
 *
 * `outstandingTaskCount` is derived here rather than left to the screen: "how
 * many do they still owe me" is the question the roster exists to answer, and a
 * surface that subtracts two numbers itself is a surface that can subtract them
 * differently from the next one.
 */
export interface SpeakerRosterEntryDto {
  readonly contactId: ContactId
  readonly email: string
  readonly name: string
  readonly bio: string | null
  readonly proposalCount: number
  readonly sessionCount: number
  readonly taskCount: number
  readonly taskCompletedCount: number
  readonly outstandingTaskCount: number
  readonly hasHeadshot: boolean
  /** True once they have written a bio AND uploaded a headshot. */
  readonly profileComplete: boolean
}

/**
 * The organizer's view of the people on their programme.
 *
 * Every speaker-side surface — the portal, onboarding tasks, the profile
 * editor, headshot and document upload — existed before this did, and an
 * organizer had no screen that listed a single speaker. So the work speakers
 * were doing arrived nowhere: an organizer could not see who had written a bio,
 * who still owed a headshot, or even who was on the programme at all, without
 * reading the submissions list and assembling the people from it by eye.
 *
 * Being on a proposal is what makes someone a speaker of the event. That is
 * already the definition the submissions list and the agenda use, so the roster
 * cannot disagree with them about who exists.
 */
export class SpeakerService {
  readonly #contacts: ContactRepository

  constructor(contacts: ContactRepository) {
    this.#contacts = contacts
  }

  async listRoster(
    _actor: OrganizerActor,
    eventId: EventId,
  ): Promise<readonly SpeakerRosterEntryDto[]> {
    const rows = await this.#contacts.listSpeakersByEvent(eventId)
    return rows.map((row) => ({
      contactId: row.contactId,
      email: row.email,
      name: row.name,
      bio: row.bio,
      proposalCount: row.proposalCount,
      sessionCount: row.sessionCount,
      taskCount: row.taskCount,
      taskCompletedCount: row.taskCompletedCount,
      outstandingTaskCount: Math.max(0, row.taskCount - row.taskCompletedCount),
      hasHeadshot: row.hasHeadshot,
      // Both halves, because chasing one without the other is how a speaker
      // ends up asked twice for something they already sent.
      profileComplete: row.hasHeadshot && (row.bio ?? '').trim().length > 0,
    }))
  }
}
