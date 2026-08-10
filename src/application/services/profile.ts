import type { SubmitterActor } from '../actors'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { ContactRepository } from '../ports/contact-repository'

export const PROFILE_NAME_MAX_LENGTH = 200
export const PROFILE_BIO_MAX_LENGTH = 2000

/** The speaker-visible profile; email is read-only identity. */
export interface SpeakerProfileDto {
  readonly name: string
  readonly email: string
  readonly bio: string | null
}

export interface UpdateProfileInput {
  readonly name: string
  readonly bio: string | null
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

  constructor(contacts: ContactRepository) {
    this.#contacts = contacts
  }

  async getOwnProfile(actor: SubmitterActor): Promise<SpeakerProfileDto> {
    const contact = await this.#contacts.findById(actor.contactId)
    if (contact === null) {
      throw new ApplicationError('not_found', 'Profile not found')
    }
    return { name: contact.name, email: contact.email, bio: contact.bio ?? null }
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
    const contact = await this.#contacts.findById(actor.contactId)
    if (contact === null) {
      throw new ApplicationError('not_found', 'Profile not found')
    }
    await this.#contacts.updateProfile(actor.contactId, { name, bio })
    return { name, email: contact.email, bio }
  }
}
