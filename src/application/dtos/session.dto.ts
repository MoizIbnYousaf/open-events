import type { ContactId, EventId, EventSlug, FormSlug, UtcInstant } from '../../domain'

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
  readonly redirectPath: string
}

/** Generic 202 start response; no link or token detail is ever revealed. */
export interface StartResponseDto {
  readonly status: 'accepted'
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
