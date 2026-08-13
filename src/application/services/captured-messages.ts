import type { CapturedMessage } from '../../domain/confirmation'
import { normalizeEmail } from '../../domain/invariants/email'
import type { CapturedMessageRepository } from '../ports/captured-message-repository'
import type { EventId } from '../../domain/event'
import type { OrganizerActor } from '../actors'

/**
 * Captured (dev) message read seam. `listByEmail` normalizes the input (trim +
 * lowercase) and returns an EXACT match on the stored normalized email. This
 * service does NOT decide local-mode authorization — whether the read may be
 * exposed is the server/route policy (fail-closed dev endpoint owned by the
 * API layer).
 */
export class CapturedMessageService {
  readonly #messages: CapturedMessageRepository

  constructor(messages: CapturedMessageRepository) {
    this.#messages = messages
  }

  async listByEmail(email: string): Promise<readonly CapturedMessage[]> {
    return this.#messages.listByEmail(normalizeEmail(email))
  }

  /**
   * The event's outbound log, for the organizer who sent it.
   *
   * "Did that invitation actually arrive?" is a question every programme chair
   * asks, and until now the only answer available was to ask the recipient.
   * The log is already written for every message the product produces, so this
   * is a read of something the product has always recorded and never shown.
   *
   * The BODY travels with each row, deliberately. A sign-in link lives in the
   * body of the message that carries it, so an organizer who can read this log
   * can act as any speaker or reviewer they have written to. That is the same
   * trust boundary an organizer already sits on — they provision reviewers,
   * decide proposals and read every submission — and it is exactly what makes
   * the log answer the question it exists for. It is not a widening of who is
   * trusted; it is a surface for what that trust already permits.
   */
  async listForEvent(
    _actor: OrganizerActor,
    eventId: EventId,
    limit = 200,
  ): Promise<readonly MessageLogEntryDto[]> {
    const rows = await this.#messages.listByEvent(eventId, limit)
    return rows.map((message) => ({
      id: message.id,
      toEmail: message.toEmail,
      subject: message.subject,
      body: message.body,
      kind: message.kind,
      submissionId: message.submissionId ?? null,
      createdAt: message.createdAt,
    }))
  }
}

/** One line of the outbound log, as the organizer's screen reads it. */
export interface MessageLogEntryDto {
  readonly id: string
  readonly toEmail: string
  readonly subject: string
  readonly body: string
  readonly kind: string
  /** The proposal this concerns, or null for anything about a person's account. */
  readonly submissionId: string | null
  readonly createdAt: string
}
