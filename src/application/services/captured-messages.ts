import type { CapturedMessage } from '../../domain/confirmation'
import { normalizeEmail } from '../../domain/invariants/email'
import type { CapturedMessageRepository } from '../ports/captured-message-repository'
import type { EventId } from '../../domain/event'
import type { OrganizerActor } from '../actors'
import { redactCapturedBody, redactCapturedRecipient } from '../dtos/communication.dto'

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

  async record(message: CapturedMessage): Promise<void> {
    await this.#messages.save(message)
  }

  /**
   * The event's outbound log, for the organizer who sent it.
   *
   * "Did that invitation actually arrive?" is a question every programme chair
   * asks, and until now the only answer available was to ask the recipient.
   * The log is already written for every message the product produces, so this
   * is a read of something the product has always recorded and never shown.
   *
   * Bearer links and full recipients never cross this organizer API. Historical
   * pre-outbox rows are redacted on read; new rows are already redacted at rest.
   */
  async listForEvent(
    _actor: OrganizerActor,
    eventId: EventId,
    limit = 200,
  ): Promise<readonly MessageLogEntryDto[]> {
    const rows = await this.#messages.listByEvent(eventId, limit)
    return rows.map((message) => ({
      id: message.id,
      toEmail: redactCapturedRecipient(message.toEmail),
      subject: message.subject,
      body: redactCapturedBody(message.body),
      kind: message.kind,
      submissionId: message.submissionId ?? null,
      createdAt: message.createdAt,
      deliveryStatus: message.deliveryStatus ?? 'captured',
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
  readonly deliveryStatus: NonNullable<CapturedMessage['deliveryStatus']>
}
