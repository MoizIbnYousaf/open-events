import type {
  CapturedMessage,
  CapturedMessageId,
  CapturedMessageKind,
  SubmissionId,
  UtcInstant,
} from '../../domain'

/** One resolved recipient of an organizer communication. */
export interface AudienceRecipientDto {
  /** Normalized (trimmed, lowercased) unique email. */
  readonly email: string
  /** True once this kind was already captured for this recipient. */
  readonly alreadySent: boolean
}

/** Rendered, not-yet-sent organizer communication (acceptance or reminder). */
export interface AcceptancePreviewDto {
  readonly submissionId: SubmissionId
  readonly kind: CapturedMessageKind
  /** The primary (owner) recipient; the full delivery set is `audience`. */
  readonly toEmail: string
  readonly subject: string
  readonly body: string
  /**
   * True once the submission has an acceptance record. The message may only be
   * sent after that, so the organizer surface can disable the send instead of
   * offering an action the API will refuse.
   */
  readonly accepted: boolean
  /** True once every resolved recipient has a stored row of this kind. */
  readonly alreadySent: boolean
  /** Owner plus contributors, deduped case-insensitively, owner first. */
  readonly audience: readonly AudienceRecipientDto[]
}

/** One immutable entry of a submission's outbound message history. */
export interface CapturedMessageDto {
  readonly id: CapturedMessageId
  readonly submissionId: SubmissionId
  readonly kind: CapturedMessageKind
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
    kind: message.kind,
    toEmail: message.toEmail,
    subject: message.subject,
    body: message.body,
    createdAt: message.createdAt,
  }
}
