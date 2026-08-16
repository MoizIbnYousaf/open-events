import type { EventId, UtcInstant } from '../../domain'
import type {
  EmailDeliveryMode,
  MailPayloadKey,
  ProtectedMailPayload,
} from '../security/mail-payload'

export type EmailDeliveryStatus =
  'captured' | 'queued' | 'leased' | 'retry' | 'accepted' | 'operator_action'

export type ProviderEmailStatus =
  'accepted' | 'sent' | 'delayed' | 'delivered' | 'bounced' | 'failed' | 'complained'

export interface EmailDeliveryConfig {
  readonly mode: EmailDeliveryMode
  readonly payloadKey: MailPayloadKey
  readonly environmentKey: string
  readonly payloadRetentionMs: number
}

export interface EmailDeliveryJob extends Omit<ProtectedMailPayload, 'nonce' | 'ciphertext'> {
  readonly eventId: EventId
  readonly status: EmailDeliveryStatus
  readonly attempts: number
  readonly nextAttemptAt: UtcInstant | null
  readonly leaseOwner: string | null
  readonly leaseExpiresAt: UtcInstant | null
  readonly providerId: string | null
  readonly lastErrorCode: string | null
  readonly ambiguousSince: UtcInstant | null
  readonly acceptedAt: UtcInstant | null
  readonly providerStatus: ProviderEmailStatus | null
  readonly providerStatusAt: UtcInstant | null
  readonly providerEventId: string | null
  readonly providerEventCount: number
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
  readonly nonce: string | null
  readonly ciphertext: string | null
}

export interface EmailDeliveryRepository {
  claimBatch(input: {
    readonly now: UtcInstant
    readonly owner: string
    readonly leaseExpiresAt: UtcInstant
    readonly limit: number
    /** Only drain jobs created under the deployment's active provider mode. */
    readonly mode: Exclude<EmailDeliveryMode, 'capture'>
  }): Promise<readonly EmailDeliveryJob[]>
  markAccepted(input: {
    readonly id: string
    readonly owner: string
    readonly providerId: string
    readonly at: UtcInstant
  }): Promise<void>
  markRetry(input: {
    readonly id: string
    readonly owner: string
    readonly code: string
    readonly nextAttemptAt: UtcInstant
    readonly ambiguousSince?: UtcInstant
    readonly at: UtcInstant
  }): Promise<void>
  markOperatorAction(input: {
    readonly id: string
    readonly owner: string
    readonly code: string
    readonly at: UtcInstant
    readonly clearPayload: boolean
  }): Promise<void>
  expirePayloads(now: UtcInstant): Promise<number>
  findById(id: string): Promise<EmailDeliveryJob | null>
}
