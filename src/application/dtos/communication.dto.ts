import type { CapturedMessage, CapturedMessageId, SubmissionId, UtcInstant } from '../../domain'

/** Rendered, not-yet-sent acceptance message (organizer preview). */
export interface AcceptancePreviewDto {
  readonly submissionId: SubmissionId
  readonly toEmail: string
  readonly subject: string
  readonly body: string
  /** True once an acceptance message exists for this submission. */
  readonly alreadySent: boolean
}

/** One immutable entry of a submission's outbound message history. */
export interface CapturedMessageDto {
  readonly id: CapturedMessageId
  readonly submissionId: SubmissionId
  readonly toEmail: string
  readonly subject: string
  readonly body: string
  readonly createdAt: UtcInstant
}

export function toCapturedMessageDto(
  message: CapturedMessage,
  submissionId: SubmissionId,
): CapturedMessageDto {
  return {
    id: message.id,
    submissionId: message.submissionId ?? submissionId,
    toEmail: message.toEmail,
    subject: message.subject,
    body: message.body,
    createdAt: message.createdAt,
  }
}
