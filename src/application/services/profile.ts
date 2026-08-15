import type { SubmitterActor } from '../actors'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { ProgrammeRepository } from '../ports/programme-repository'

export const PROFILE_NAME_MAX_LENGTH = 200
export const PROFILE_BIO_MAX_LENGTH = 2000
export const PROFILE_JOB_TITLE_MAX_LENGTH = 200
export const PROFILE_COMPANY_MAX_LENGTH = 200

/** The speaker-visible profile; email is read-only identity. */
export interface SpeakerProfileDto {
  readonly name: string
  readonly email: string
  readonly bio: string | null
  readonly jobTitle: string
  readonly company: string
}

export interface UpdateProfileInput {
  readonly name: string
  readonly bio: string | null
  readonly jobTitle?: string
  readonly company?: string
}

/**
 * REQ-006 speaker profile self-service. Identity comes only from the typed
 * submitter actor — there is no path parameter or body field naming a
 * contact, so another speaker's row is unreachable by construction. Writes
 * touch exactly the speaker-editable fields (name, bio); email and creation
 * identity never change.
 */
export class ProfileService {
  readonly #contacts: ContactRepository
  readonly #programme: ProgrammeRepository | null
  readonly #clock: Clock | null

  constructor(
    contacts: ContactRepository,
    programme: ProgrammeRepository | null = null,
    clock: Clock | null = null,
  ) {
    this.#contacts = contacts
    this.#programme = programme
    this.#clock = clock
  }

  async getOwnProfile(actor: SubmitterActor): Promise<SpeakerProfileDto> {
    const contact = await this.#contacts.findById(actor.contactId)
    if (contact === null) {
      throw new ApplicationError('not_found', 'Profile not found')
    }
    const roster = await this.#contacts.listSpeakersByEvent(actor.eventId)
    const fromRoster = roster.find((row) => row.contactId === actor.contactId)
    const stored =
      fromRoster ??
      (this.#programme === null
        ? null
        : await this.#programme.findSpeakerProfile(actor.eventId, actor.contactId))
    return {
      name: contact.name,
      email: contact.email,
      bio: contact.bio ?? null,
      jobTitle: stored?.jobTitle ?? '',
      company: stored?.company ?? '',
    }
  }

  async updateOwnProfile(
    actor: SubmitterActor,
    input: UpdateProfileInput,
  ): Promise<SpeakerProfileDto> {
    const name = input.name.trim()
    if (name.length === 0) {
      throw new ValidationFailedError('A profile name is required', [])
    }
    if (name.length > PROFILE_NAME_MAX_LENGTH) {
      throw new ValidationFailedError(
        `The profile name exceeds ${PROFILE_NAME_MAX_LENGTH} characters`,
        [],
      )
    }
    const trimmedBio = input.bio === null ? null : input.bio.trim()
    const bio = trimmedBio === null || trimmedBio.length === 0 ? null : trimmedBio
    if (bio !== null && bio.length > PROFILE_BIO_MAX_LENGTH) {
      throw new ValidationFailedError(`The bio exceeds ${PROFILE_BIO_MAX_LENGTH} characters`, [])
    }
    const roster = await this.#contacts.listSpeakersByEvent(actor.eventId)
    const fromRoster = roster.find((row) => row.contactId === actor.contactId)
    const existing =
      fromRoster ??
      (this.#programme === null
        ? null
        : await this.#programme.findSpeakerProfile(actor.eventId, actor.contactId))
    const jobTitle =
      input.jobTitle === undefined ? (existing?.jobTitle ?? '') : input.jobTitle.trim()
    const company = input.company === undefined ? (existing?.company ?? '') : input.company.trim()
    if (jobTitle.length > PROFILE_JOB_TITLE_MAX_LENGTH) {
      throw new ValidationFailedError(
        `The job title exceeds ${PROFILE_JOB_TITLE_MAX_LENGTH} characters`,
        [],
      )
    }
    if (company.length > PROFILE_COMPANY_MAX_LENGTH) {
      throw new ValidationFailedError(
        `The company exceeds ${PROFILE_COMPANY_MAX_LENGTH} characters`,
        [],
      )
    }
    const contact = await this.#contacts.findById(actor.contactId)
    if (contact === null) {
      throw new ApplicationError('not_found', 'Profile not found')
    }
    await this.#contacts.updateProfile(actor.contactId, { name, bio })
    if (this.#programme !== null && this.#clock !== null) {
      const now = this.#clock.now()
      await this.#contacts.upsertSpeakerProfile({
        eventId: actor.eventId,
        contactId: actor.contactId,
        jobTitle,
        company,
        travelNotes: existing?.travelNotes ?? '',
        workflowStatus: existing?.workflowStatus ?? 'invited',
        createdAt: now,
        updatedAt: now,
      })
    }
    return { name, email: contact.email, bio, jobTitle, company }
  }
}
