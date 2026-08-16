import type {
  CapturedMessage,
  CapturedMessageKind,
  ContactId,
  EventId,
  SubmissionId,
  SubmitterAccessPurpose,
} from '../../domain'
import type { OrganizerActor } from '../actors'
import type { StartMailBudgetReservation } from './session-unit-of-work'

export type RoleAccessProof =
  | {
      readonly kind: 'speaker-member'
      /** Null means any submitted proposal or organizer-created speaker profile in this event. */
      readonly submissionId: SubmissionId | null
    }
  | { readonly kind: 'committee-member' }

export interface RoleAccessIssueInput {
  readonly eventId: EventId
  readonly contactId: ContactId
  readonly email: string
  readonly purpose: Exclude<SubmitterAccessPurpose, 'cfp'>
  readonly subject: string
  readonly renderBody: (absoluteAccessUrl: string) => string
  readonly kind: CapturedMessageKind
  readonly submissionId?: SubmissionId | null
  readonly proof: RoleAccessProof
  /**
   * Optional only for organizer flows that never used the anonymous-start mail
   * budget. Reviewer seating/assignment supplies this so the U2 recipient and
   * environment budgets stay atomic with its role token and capture.
   */
  readonly budget?: StartMailBudgetReservation
}

export type RoleAccessIssueResult =
  | {
      readonly outcome: 'issued'
      readonly accessUrl: string
      readonly message: CapturedMessage
    }
  | { readonly outcome: 'limited' }

/** Atomically persists a per-recipient role token with the message carrying it. */
export interface RoleAccessIssuer {
  issueRoleAccess(
    actor: OrganizerActor,
    input: RoleAccessIssueInput,
  ): Promise<RoleAccessIssueResult>
}
