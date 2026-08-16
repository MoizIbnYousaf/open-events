import type {
  CapturedMessage,
  ConfirmationRecord,
  ContactId,
  DraftId,
  EventId,
  FormId,
  ProposalSubmission,
  SubmitterSession,
  UtcInstant,
} from '../../domain'
import type { CfpSubmitSource } from '../dtos/session.dto'

/** Normalized co-speaker contact intent; upserted inside the submit batch. */
export interface CoSpeakerIntent {
  readonly name: string
  readonly email: string
}

/**
 * Submit transaction input. Implementations (the D1 adapter in `src/db`) MUST
 * run the entire decision and write set in one atomic batch:
 *
 * 1. re-read the form row and compute submission counts inside the transaction;
 * 2. evaluate the gate with `evaluateFormSubmitGate` (domain) against the
 *    freshest row: the form must be `status = 'published'` AND
 *    `published_version_id = submission.formVersionId` (version drift or an
 *    unpublished form is a deterministic `closed` outcome), plus the
 *    open/close and cap predicates with the documented limits semantics
 *    (NULL = unlimited; non-null caps are positive integers; per-identity
 *    count for the owner). This exact contract is the M2B SQL gate;
 * 3. upsert co-speaker contacts (dedupe by normalized email) in the same
 *    batch — rejected gates (`closed`/`capped`/`identity-limited`) and any
 *    failure cause ZERO contact writes;
 * 4. insert the submission under the global `UNIQUE(origin_draft_id)` with
 *    `ON CONFLICT DO NOTHING`, then read the existing row in the SAME batch:
 *    ANY existing-row hit returns `existing-idempotent` with the RAW row —
 *    implementations must never scope the conflict lookup by actor and must
 *    never turn a foreign hit into an internal error. `SubmitService`
 *    compares the row's owner/event against the session actor and maps a
 *    foreign hit to a safe `not_found`. Outcome mapping must use guarded
 *    statements and per-statement `changes`, never exceptions, so the batch
 *    is retryable and never aborts on an idempotent retry;
 * 5. insert contributors (primary owner at position 0, co-speakers 1..n using
 *    the upserted contact ids), captured message, confirmation, and delete the
 *    draft in the same batch.
 */
export interface SubmitBatchInput {
  readonly eventId: EventId
  readonly formId: FormId
  readonly originDraftId: DraftId
  readonly ownerContactId: ContactId
  readonly submittedAt: UtcInstant
  readonly submission: ProposalSubmission
  /**
   * Co-speaker intents, upserted inside the batch (dedupe by normalized
   * email). Bounded by the shared domain constant `MAX_CO_SPEAKERS` (10,
   * `src/domain/contact.ts`): BOTH boundaries MUST reject a longer list
   * before any contact read/write or D1 statement — the `SubmitService`
   * pre-check throws `ValidationFailedError`, and every adapter must throw
   * before any batch statement, with the same stable message
   * `A submission may include at most 10 co-speakers` and zero writes.
   */
  readonly coSpeakers: readonly CoSpeakerIntent[]
  readonly confirmation: ConfirmationRecord
  readonly message: CapturedMessage
  /** Present on the public route: business commit and CFP -> portal handoff are atomic. */
  readonly handoff?: SubmitSessionHandoffIntent
}

export interface SubmitSessionHandoffIntent {
  readonly cfpSessionId: string
  readonly requestHash: string
  readonly portalSession: SubmitterSession & { readonly capability: 'portal' }
  readonly source: CfpSubmitSource
}

export interface SubmitSessionHandoffResult {
  readonly portalSessionId: string
  readonly expiresAt: UtcInstant
}

/** Discriminated submit result; the D1 adapter is the concurrency guarantee. */
export type SubmitBatchResult =
  | {
      readonly outcome: 'inserted'
      readonly submission: ProposalSubmission
      readonly handoff?: SubmitSessionHandoffResult
    }
  | {
      readonly outcome: 'existing-idempotent'
      readonly submission: ProposalSubmission
      readonly handoff?: SubmitSessionHandoffResult
    }
  | { readonly outcome: 'handoff-invalid' }
  | { readonly outcome: 'closed' }
  | { readonly outcome: 'capped' }
  | { readonly outcome: 'identity-limited' }

export interface SubmitUnitOfWork {
  execute(input: SubmitBatchInput): Promise<SubmitBatchResult>
  recoverHandoff(input: {
    readonly cfpSessionId: string
    readonly eventId: EventId
    readonly ownerContactId: ContactId
    readonly originDraftId: DraftId
    readonly requestHash: string
  }): Promise<
    | {
        readonly outcome: 'existing-idempotent'
        readonly submission: ProposalSubmission
        readonly handoff: SubmitSessionHandoffResult
      }
    | { readonly outcome: 'handoff-invalid' }
  >
}
