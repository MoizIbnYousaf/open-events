import type { ContactId, EventId, Session } from '../domain'

/**
 * Non-forgeable actor-scoped identity for public submitter flows. Instances
 * are created ONLY by `toSubmitterActor` from a validated domain `Session`
 * (kind `'submitter'`); the private constructor makes plain fabricated object
 * literals unrepresentable at the type level.
 */
export class SubmitterActor {
  declare private readonly __submitterBrand: undefined

  readonly contactId: ContactId
  readonly eventId: EventId

  private constructor(contactId: ContactId, eventId: EventId) {
    this.contactId = contactId
    this.eventId = eventId
  }

  static fromSession(session: Session): SubmitterActor | null {
    if (session.kind !== 'submitter') return null
    return new SubmitterActor(session.contactId, session.eventId)
  }
}

/** Narrowing factory: submitter sessions only; returns null for organizers. */
export function toSubmitterActor(session: Session): SubmitterActor | null {
  return SubmitterActor.fromSession(session)
}

/**
 * Non-forgeable organizer actor marker. Instances are created ONLY by
 * `toOrganizerActor` from a validated organizer `Session`; a plain fabricated
 * object literal cannot typecheck as an organizer actor.
 */
export class OrganizerActor {
  declare private readonly __organizerBrand: undefined

  readonly kind = 'organizer' as const

  private constructor() {}

  static fromSession(session: Session): OrganizerActor | null {
    return session.kind === 'organizer' ? new OrganizerActor() : null
  }
}

/** Narrowing factory: organizer sessions only; returns null for submitters. */
export function toOrganizerActor(session: Session): OrganizerActor | null {
  return OrganizerActor.fromSession(session)
}
