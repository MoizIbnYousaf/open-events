import type {
  CapturedMessage,
  ContactId,
  Session,
  SessionId,
  SubmitterToken,
  TokenId,
  UtcInstant,
} from '../../domain'
import type { RoleAccessProof } from './role-access-issuer'

export type RedeemSubmitterTokenResult =
  { readonly outcome: 'redeemed' } | { readonly outcome: 'conflict' }

export type RotateSessionResult = { readonly outcome: 'rotated' } | { readonly outcome: 'conflict' }
export type IssueStartResult = { readonly outcome: 'issued' } | { readonly outcome: 'limited' }
export type IssueRoleAccessResult =
  | { readonly outcome: 'issued' }
  | { readonly outcome: 'limited' }
  | { readonly outcome: 'conflict' }

export const START_MAIL_BUDGET_POLICY = {
  recipientCooldownMs: 2 * 60 * 1000,
  rollingWindowMs: 24 * 60 * 60 * 1000,
  recipientRolling24HourLimit: 5,
  environmentRolling24HourLimit: 250,
} as const

/** HMAC-derived budget keys plus a unique reservation id; contains no raw PII. */
export interface StartMailBudgetReservation {
  readonly operationId: string
  readonly recipientKey: string
  readonly environmentKey: string
  readonly now: UtcInstant
}

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
    readonly budget: StartMailBudgetReservation
  }): Promise<IssueStartResult>
  issueRoleAccess(input: {
    readonly token: SubmitterToken
    readonly message: CapturedMessage
    readonly proof: RoleAccessProof
    readonly budget?: StartMailBudgetReservation
  }): Promise<IssueRoleAccessResult>
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
