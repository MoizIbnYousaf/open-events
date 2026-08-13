/** One outbound email, already rendered by whoever asked for it to be sent. */
export interface OutboundEmail {
  readonly to: string
  readonly subject: string
  readonly body: string
}

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
   * Attempts delivery. Implementations must not throw: a message that could not
   * be delivered is still recorded, and an email provider having a bad morning
   * must never fail the submission that triggered it.
   */
  send(email: OutboundEmail): Promise<void>
}
