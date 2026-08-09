import type { ContactId } from './contact.ts'
import type { EventId, UtcInstant } from './event.ts'
import type { FormId } from './form.ts'

export type TokenId = string
export type SessionId = string
export type TokenHash = string

export const SESSION_KINDS = ['organizer', 'submitter'] as const

export type SessionKind = (typeof SESSION_KINDS)[number]

/** Single-use submitter start-link token; only its hash is persisted. */
export interface SubmitterToken {
  readonly id: TokenId
  readonly contactId: ContactId
  readonly eventId: EventId
  readonly formId: FormId
  readonly tokenHash: TokenHash
  readonly expiresAt: UtcInstant
  readonly consumedAt: UtcInstant | null
  readonly createdAt: UtcInstant
}

export interface BaseSession {
  readonly id: SessionId
  readonly tokenHash: TokenHash
  readonly expiresAt: UtcInstant
  readonly consumedAt: UtcInstant | null
  readonly createdAt: UtcInstant
}

/** Organizer session: no submitter subject member at all. */
export interface OrganizerSession extends BaseSession {
  readonly kind: 'organizer'
}

/** Submitter session: the persisted contact identity is required. */
export interface SubmitterSession extends BaseSession {
  readonly kind: 'submitter'
  readonly contactId: ContactId
  readonly eventId: EventId
}

export type Session = OrganizerSession | SubmitterSession

export const SESSION_IDENTITY_ISSUE_CODES = [
  'submitter_without_contact',
  'submitter_without_event',
  'organizer_with_contact',
  'organizer_with_event',
] as const

export type SessionIdentityIssueCode = (typeof SESSION_IDENTITY_ISSUE_CODES)[number]

export interface SessionIdentityIssue {
  readonly code: SessionIdentityIssueCode
  readonly message: string
}

/**
 * Kind/identity invariant for rows decoded at the adapter boundary (D1 rows
 * are not type-safe). Application-layer `Session` values are discriminated and
 * cannot represent an invalid combination.
 */
export interface DecodedSessionRow {
  readonly id: SessionId
  readonly kind: SessionKind
  /** D1 reality: NULL for organizer rows, NOT NULL for submitter rows. */
  readonly contactId: ContactId | null
  readonly eventId?: EventId
  readonly tokenHash: TokenHash
  readonly expiresAt: UtcInstant
  readonly consumedAt: UtcInstant | null
  readonly createdAt: UtcInstant
}

export function validateSessionIdentity(
  session: DecodedSessionRow,
): readonly SessionIdentityIssue[] {
  if (
    session.kind === 'submitter' &&
    (session.contactId === null ||
      session.contactId === undefined ||
      session.contactId.length === 0)
  ) {
    return [
      {
        code: 'submitter_without_contact',
        message: 'A submitter session must carry a persisted contactId',
      },
    ]
  }
  if (
    session.kind === 'organizer' &&
    session.contactId !== null &&
    session.contactId !== undefined
  ) {
    return [
      {
        code: 'organizer_with_contact',
        message: 'An organizer session must not carry a contactId',
      },
    ]
  }
  if (session.kind === 'organizer' && session.eventId !== undefined && session.eventId !== null) {
    return [
      {
        code: 'organizer_with_event',
        message: 'An organizer session must not carry an eventId',
      },
    ]
  }
  if (
    session.kind === 'submitter' &&
    (session.eventId === undefined || session.eventId.length === 0)
  ) {
    return [
      {
        code: 'submitter_without_event',
        message: 'A submitter session must carry a persisted eventId',
      },
    ]
  }
  return []
}

/** The persisted identity subject of a session, or null for organizer sessions. */
export function getSessionContactId(session: Session): ContactId | null {
  return session.kind === 'submitter' ? session.contactId : null
}
