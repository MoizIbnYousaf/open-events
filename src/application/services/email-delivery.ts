import type { Clock } from '../ports/clock'
import type {
  EmailDeliveryConfig,
  EmailDeliveryJob,
  EmailDeliveryRepository,
} from '../ports/email-delivery-repository'
import type { EmailSender } from '../ports/email-sender'
import { decryptMailPayload } from '../security/mail-payload'

const LEASE_MS = 30_000
const MAX_ATTEMPTS = 6
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000

function addMillis(value: string, amount: number): string {
  return new Date(Date.parse(value) + amount).toISOString()
}

function retryDelayMs(attempts: number, providerSeconds?: number): number {
  const exponential = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1))
  return Math.max(exponential, (providerSeconds ?? 0) * 1000)
}

export interface EmailDrainSummary {
  readonly claimed: number
  readonly accepted: number
  readonly retried: number
  readonly operatorAction: number
  readonly expired: number
}

export class EmailDeliveryService {
  readonly #repository: EmailDeliveryRepository
  readonly #sender: EmailSender
  readonly #config: EmailDeliveryConfig
  readonly #clock: Clock

  constructor(
    repository: EmailDeliveryRepository,
    sender: EmailSender,
    config: EmailDeliveryConfig,
    clock: Clock,
  ) {
    this.#repository = repository
    this.#sender = sender
    this.#config = config
    this.#clock = clock
  }

  async drain(
    options: {
      readonly limit?: number
      readonly owner?: string
    } = {},
  ): Promise<EmailDrainSummary> {
    const now = this.#clock.now()
    const expired = await this.#repository.expirePayloads(now)
    if (this.#config.mode === 'capture') {
      return { claimed: 0, accepted: 0, retried: 0, operatorAction: 0, expired }
    }
    const owner = options.owner ?? crypto.randomUUID()
    const jobs = await this.#repository.claimBatch({
      now,
      owner,
      leaseExpiresAt: addMillis(now, LEASE_MS),
      limit: options.limit ?? 10,
      mode: this.#config.mode,
    })
    let accepted = 0
    let retried = 0
    let operatorAction = 0
    for (const job of jobs) {
      const outcome = await this.#deliver(job, owner, now)
      if (outcome === 'accepted') accepted += 1
      else if (outcome === 'retry') retried += 1
      else operatorAction += 1
    }
    return { claimed: jobs.length, accepted, retried, operatorAction, expired }
  }

  async #deliver(
    job: EmailDeliveryJob,
    owner: string,
    now: string,
  ): Promise<'accepted' | 'retry' | 'operator_action'> {
    if (job.mode === 'capture' || job.nonce === null || job.ciphertext === null) {
      await this.#repository.markOperatorAction({
        id: job.jobId,
        owner,
        code: 'invalid_delivery_job',
        at: now,
        clearPayload: true,
      })
      return 'operator_action'
    }
    let payload: { readonly to: string; readonly subject: string; readonly body: string }
    try {
      payload = await decryptMailPayload(
        {
          jobId: job.jobId,
          messageId: job.messageId,
          mode: job.mode,
          recipientFingerprint: job.recipientFingerprint,
          recipientLabel: '',
          auditBody: '',
          keyVersion: job.keyVersion,
          nonce: job.nonce,
          ciphertext: job.ciphertext,
          expiresAt: job.expiresAt,
        },
        this.#config.payloadKey,
      )
    } catch {
      await this.#repository.markOperatorAction({
        id: job.jobId,
        owner,
        code: 'payload_decryption_failed',
        at: now,
        clearPayload: true,
      })
      return 'operator_action'
    }

    const result = await this.#sender.send({ jobId: job.jobId, mode: job.mode, ...payload })
    if (result.outcome === 'accepted') {
      await this.#repository.markAccepted({
        id: job.jobId,
        owner,
        providerId: result.providerId,
        at: now,
      })
      return 'accepted'
    }
    if (result.outcome === 'captured') {
      await this.#repository.markOperatorAction({
        id: job.jobId,
        owner,
        code: 'provider_mode_mismatch',
        at: now,
        clearPayload: false,
      })
      return 'operator_action'
    }
    if (result.outcome === 'operator_action' || job.attempts >= MAX_ATTEMPTS) {
      await this.#repository.markOperatorAction({
        id: job.jobId,
        owner,
        code: result.outcome === 'operator_action' ? result.code : 'attempts_exhausted',
        at: now,
        clearPayload: false,
      })
      return 'operator_action'
    }
    if (
      result.outcome === 'ambiguous' &&
      Date.parse(now) - Date.parse(job.createdAt) >= IDEMPOTENCY_WINDOW_MS
    ) {
      await this.#repository.markOperatorAction({
        id: job.jobId,
        owner,
        code: 'idempotency_window_expired',
        at: now,
        clearPayload: false,
      })
      return 'operator_action'
    }
    const nextAttemptAt = addMillis(
      now,
      retryDelayMs(job.attempts, result.outcome === 'retry' ? result.retryAfterSeconds : undefined),
    )
    await this.#repository.markRetry({
      id: job.jobId,
      owner,
      code: result.code,
      nextAttemptAt,
      ...(result.outcome === 'ambiguous' ? { ambiguousSince: now } : {}),
      at: now,
    })
    return 'retry'
  }
}
