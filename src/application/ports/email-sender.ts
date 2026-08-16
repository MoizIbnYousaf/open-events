/** One outbound email, already rendered by whoever asked for it to be sent. */
export interface OutboundEmail {
  /** Stable D1 job id; also the provider idempotency key and correlation tag. */
  readonly jobId: string
  /** Immutable mode captured with the durable job when the message was created. */
  readonly mode: 'resend-test' | 'resend-live'
  readonly to: string
  readonly subject: string
  readonly body: string
}

export type EmailSendResult =
  | { readonly outcome: 'captured' }
  | { readonly outcome: 'accepted'; readonly providerId: string }
  | { readonly outcome: 'retry'; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly outcome: 'ambiguous'; readonly code: string }
  | { readonly outcome: 'operator_action'; readonly code: string }

/**
 * Delivery of a message the product has already decided to send.
 *
 * Separate from the captured-message log on purpose: the log is the RECORD of
 * what the product said, and it is written whether or not anything leaves the
 * building. Delivery is a second, failable act on top of that record. Keeping
 * them apart is what lets development and the whole test suite capture without
 * sending, and what makes a provider outage a delivery problem rather than a
 * lost proposal.
 */
export interface EmailSender {
  /**
   * Attempts delivery. Implementations must not throw: the durable job records
   * every outcome, and a provider failure must never erase the business write
   * that created it.
   */
  send(email: OutboundEmail): Promise<EmailSendResult>
}
