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

/** Captured (dev) outbound message; the raw magic link appears only here. */
export interface CapturedMessage {
  readonly id: CapturedMessageId
  readonly eventId: EventId
  readonly toEmail: string
  readonly subject: string
  readonly body: string
  readonly createdAt: UtcInstant
  /**
   * Submission this message belongs to (acceptance communications). Absent or
   * null for start-link deliveries, which are not scoped to a submission.
   */
  readonly submissionId?: SubmissionId | null
}
