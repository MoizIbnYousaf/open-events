import type {
  CapturedMessage,
  ContactId,
  Session,
  SessionId,
  SubmitterToken,
  TokenId,
  UtcInstant,
} from '../../domain'

export type RedeemSubmitterTokenResult =
  { readonly outcome: 'redeemed' } | { readonly outcome: 'conflict' }

export type RotateSessionResult = { readonly outcome: 'rotated' } | { readonly outcome: 'conflict' }

/** Contact create/upsert intent for the atomic start flow. */
export interface ContactIntent {
  readonly id: ContactId
  readonly email: string
  readonly name: string
  readonly createdAt: UtcInstant
}

/**
 * Atomic session/token operations. Implementations (the D1 adapter in
 * `src/db`) MUST run each operation in one batch:
 *
 * - `issueStart`: upsert the contact by normalized email and persist the
 *   raw-link token together with its captured message in ONE batch. The
 *   token's contact reference must resolve to the actually persisted contact
 *   row (email-keyed subquery), so concurrent starts for a never-seen email
 *   converge on a single contact and never duplicate it. The raw link in the
 *   captured message is an explicit local/dev delivery requirement; its
 *   fail-closed endpoint protection is M2C's responsibility. The token's
 *   `formId` is persisted with it (`form_id` column);
 * - `redeemSubmitterToken`: consume the start token (conditional on it being
 *   unconsumed/unexpired) and insert the rotated session atomically, returning
 *   `conflict` when the token is already consumed;
 * - `rotateSession`: consume the current session (conditional on it being
 *   unconsumed/unexpired) and insert the rotated session atomically.
 */
export interface SessionUnitOfWork {
  issueStart(input: {
    readonly contact: ContactIntent
    readonly token: SubmitterToken
    readonly message: CapturedMessage
  }): Promise<void>
  redeemSubmitterToken(input: {
    readonly tokenId: TokenId
    readonly consumedAt: UtcInstant
    readonly session: Session
  }): Promise<RedeemSubmitterTokenResult>
  rotateSession(input: {
    readonly sessionId: SessionId
    readonly consumedAt: UtcInstant
    readonly rotated: Session
  }): Promise<RotateSessionResult>
}
