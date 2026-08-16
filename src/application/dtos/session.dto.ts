import type {
  ContactId,
  EventId,
  EventSlug,
  FormSlug,
  SessionCapability,
  UtcInstant,
} from '../../domain'
import type { SubmitterSession } from '../../domain'
import type { SubmitterActor } from '../actors'

export interface OrganizerSessionDto {
  readonly token: string
  readonly expiresAt: UtcInstant
}

export interface SubmitterSessionDto {
  readonly token: string
  readonly expiresAt: UtcInstant
  readonly contactId: ContactId
  readonly eventId: EventId
}

/**
 * Redeem result: the submitter session credentials (unchanged shape) plus the
 * trusted redirect target. Extends `SubmitterSessionDto` so existing direct
 * `token`/`expiresAt`/`contactId`/`eventId` callers keep working without
 * broadening the session DTO itself.
 */
export interface RedeemResult extends SubmitterSessionDto {
  readonly capability: SessionCapability | null
  readonly redirectPath: string
}

/** Generic 202 start response; no link or token detail is ever revealed. */
export interface StartResponseDto {
  readonly status: 'accepted'
  readonly guidance:
    | 'Check your email. Check your spam folder, wait two minutes, then try again.'
    | 'Request accepted for this demo. Email delivery is not enabled, so no inbox message will arrive.'
}

export const START_RESPONSE: StartResponseDto = {
  status: 'accepted',
  guidance: 'Check your email. Check your spam folder, wait two minutes, then try again.',
}

export const CAPTURE_START_RESPONSE: StartResponseDto = {
  status: 'accepted',
  guidance:
    'Request accepted for this demo. Email delivery is not enabled, so no inbox message will arrive.',
}

/**
 * Public start request: email plus the two-segment public address
 * (`eventSlug` + `formSlug`). The server resolves the event and derives the
 * exact published form; no client-supplied event id is ever accepted.
 */
export interface StartInput {
  readonly email: string
  readonly eventSlug: EventSlug
  readonly formSlug: FormSlug
}

export interface RotatedSessionDto {
  readonly token: string
  readonly expiresAt: UtcInstant
  readonly kind: 'organizer' | 'submitter'
}

/**
 * Narrow authority prepared from a real CFP cookie for exactly one submit
 * request. A consumed CFP session may produce only the retry form; the submit
 * UOW must prove the persisted handoff before it returns portal access.
 */
export interface CfpSubmitAuthorization {
  readonly actor: SubmitterActor
  readonly mode: 'initial' | 'retry'
  readonly cfpSessionId: string
  readonly originDraftId: string
  readonly requestHash: string
  readonly portalToken: string
  readonly portalSession: SubmitterSession & { readonly capability: 'portal' }
  readonly source: CfpSubmitSource
}

export type CfpSubmitSource =
  | { readonly kind: 'cfp' }
  | { readonly kind: 'legacy-rollout' }
  | {
      readonly kind: 'legacy-bounded'
      readonly lastLegacyWriterCutoff: UtcInstant
      readonly compatibilityEndsAt: UtcInstant
    }
