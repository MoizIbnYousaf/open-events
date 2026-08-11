import type { CapturedMessage } from '../../domain/confirmation'
import { normalizeEmail } from '../../domain/invariants/email'
import type { CapturedMessageRepository } from '../ports/captured-message-repository'

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
}
