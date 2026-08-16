import type { EventId, UtcInstant } from './event.ts'
import type { SubmissionId } from './submission.ts'

export type ConfirmationId = string
export type CapturedMessageId = string

export interface ConfirmationRecord {
  readonly id: ConfirmationId
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly capturedMessageId: CapturedMessageId
  readonly createdAt: UtcInstant
}

/**
 * What a captured outbound message is: a public confirmation capture (start
 * links and submit confirmations, never submission-scoped for idempotency) or
 * an organizer acceptance/reminder send (submission-scoped, once per
 * kind/recipient).
 */
export const CAPTURED_MESSAGE_KINDS = ['confirmation', 'acceptance', 'reminder'] as const

export type CapturedMessageKind = (typeof CAPTURED_MESSAGE_KINDS)[number]
export type CapturedMessageDeliveryStatus =
  | 'captured'
  | 'queued'
  | 'leased'
  | 'retry'
  | 'accepted'
  | 'sent'
  | 'delayed'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'complained'
  | 'operator_action'

/** Captured (dev) outbound message; the raw magic link appears only here. */
export interface CapturedMessage {
  readonly id: CapturedMessageId
  readonly eventId: EventId
  readonly toEmail: string
  readonly subject: string
  readonly body: string
  readonly createdAt: UtcInstant
  readonly kind: CapturedMessageKind
  readonly deliveryStatus?: CapturedMessageDeliveryStatus
  /** Which hard provider budget applies when this intent becomes sendable. */
  readonly deliveryBudgetClass?: 'system' | 'organizer'
  /**
   * Submission this message belongs to (acceptance/reminder communications).
   * Absent or null for confirmation captures, which are not scoped to a
   * submission.
   */
  readonly submissionId?: SubmissionId | null
}
