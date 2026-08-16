import type {
  CapturedMessage,
  CapturedMessageId,
  CapturedMessageKind,
  SubmissionId,
  SubmissionOutcome,
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
  /**
   * The standing programme verdict, and 'pending' while nobody has ruled —
   * one spelling of undecided, never null and never absent.
   *
   * `accepted` above reports only whether the acceptance RECORD exists, and
   * that record survives a later rejection because the onboarding checklist
   * hangs its foreign key off it — so this is the field that says what the
   * organizer actually decided.
   */
  readonly decision: SubmissionOutcome
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
  readonly deliveryStatus: NonNullable<CapturedMessage['deliveryStatus']>
}

export function redactCapturedRecipient(value: string): string {
  const separator = value.lastIndexOf('@')
  if (separator <= 0) return 'redacted-recipient'
  return `${value.slice(0, 1)}***${value.slice(separator)}`
}

export function redactCapturedBody(value: string): string {
  void value
  return 'Message content is protected in the encrypted delivery job.'
}

export function toCapturedMessageDto(
  message: CapturedMessage,
  submissionId: SubmissionId,
): CapturedMessageDto {
  return {
    id: message.id,
    submissionId: message.submissionId ?? submissionId,
    kind: message.kind,
    toEmail: redactCapturedRecipient(message.toEmail),
    subject: message.subject,
    body: redactCapturedBody(message.body),
    createdAt: message.createdAt,
    deliveryStatus: message.deliveryStatus ?? 'captured',
  }
}
