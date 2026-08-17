import type { ContactId, EventId, Session, SessionCapability } from '../domain'
import { ApplicationError } from './errors'

const LEGACY_COMPATIBILITY = Symbol('validated legacy submitter compatibility')

export type ValidatedLegacySubmitterSession = Extract<Session, { kind: 'submitter' }> & {
  readonly capability: null
  readonly [LEGACY_COMPATIBILITY]: true
}

export type ValidatedSession = Session | ValidatedLegacySubmitterSession

/** Called only after SessionService has checked the configured compatibility horizon. */
export function markValidatedLegacySession(
  session: Extract<Session, { kind: 'submitter' }> & { readonly capability: null },
): ValidatedLegacySubmitterSession {
  return Object.assign({}, session, { [LEGACY_COMPATIBILITY]: true as const })
}

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
  readonly capability: SessionCapability | null
  readonly legacyBroadAuthority: boolean
  readonly tourAuthority: boolean

  private constructor(
    contactId: ContactId,
    eventId: EventId,
    capability: SessionCapability | null,
    legacyBroadAuthority: boolean,
    tourAuthority: boolean,
  ) {
    this.contactId = contactId
    this.eventId = eventId
    this.capability = capability
    this.legacyBroadAuthority = legacyBroadAuthority
    this.tourAuthority = tourAuthority
  }

  static fromSession(session: ValidatedSession): SubmitterActor | null {
    if (session.kind !== 'submitter') return null
    if (
      session.capability === null &&
      (!(LEGACY_COMPATIBILITY in session) || session[LEGACY_COMPATIBILITY] !== true)
    ) {
      return null
    }
    return new SubmitterActor(
      session.contactId,
      session.eventId,
      session.capability,
      session.capability === null,
      session.provenance === 'tour',
    )
  }
}

/** Narrowing factory: submitter sessions only; returns null for organizers. */
export function toSubmitterActor(session: ValidatedSession): SubmitterActor | null {
  return SubmitterActor.fromSession(session)
}

/**
 * Application-service authorization boundary. A legacy actor is broad only
 * when it carries SessionService's explicit bounded-compatibility marker;
 * arbitrary null-capability rows never become actors.
 */
export function assertSubmitterCapability(
  actor: SubmitterActor,
  ...allowed: readonly SessionCapability[]
): void {
  if (
    actor.legacyBroadAuthority ||
    (actor.capability !== null && allowed.includes(actor.capability))
  ) {
    return
  }
  throw new ApplicationError('forbidden', 'This link cannot perform that role action')
}

/**
 * Non-forgeable organizer actor marker. Instances are created ONLY by
 * `toOrganizerActor` from a validated organizer `Session`; a plain fabricated
 * object literal cannot typecheck as an organizer actor.
 */
export class OrganizerActor {
  declare private readonly __organizerBrand: undefined

  readonly kind = 'organizer' as const
  readonly tourAuthority: boolean

  private constructor(tourAuthority: boolean) {
    this.tourAuthority = tourAuthority
  }

  static fromSession(session: Session): OrganizerActor | null {
    return session.kind === 'organizer' ? new OrganizerActor(session.provenance === 'tour') : null
  }
}

/** Narrowing factory: organizer sessions only; returns null for submitters. */
export function toOrganizerActor(session: Session): OrganizerActor | null {
  return OrganizerActor.fromSession(session)
}

export function assertActorCanMutate(actor: OrganizerActor | SubmitterActor): void {
  if (actor.tourAuthority) {
    throw new ApplicationError('forbidden', 'The guided tour is read-only')
  }
}
