import type { UtcInstant } from '../../domain'
import type { ProviderEmailStatus } from './email-delivery-repository'

export const RESEND_DELIVERY_EVENT_TYPES = [
  'email.sent',
  'email.delivery_delayed',
  'email.delivered',
  'email.bounced',
  'email.failed',
  'email.suppressed',
  'email.complained',
] as const

export type ResendDeliveryEventType = (typeof RESEND_DELIVERY_EVENT_TYPES)[number]

export interface ResendDeliveryEvent {
  /** Resend's `svix-id`; the immutable replay/deduplication key. */
  readonly id: string
  readonly providerEmailId: string
  /** Correlation tag added to the original provider request, when present. */
  readonly jobTag: string | null
  readonly type: ResendDeliveryEventType
  readonly createdAt: UtcInstant
  readonly receivedAt: UtcInstant
}

export interface ResendWebhookRecordResult {
  readonly inserted: boolean
  readonly matched: boolean
  readonly status: ProviderEmailStatus | null
}

export interface EmailDeliveryWebhookRepository {
  record(event: ResendDeliveryEvent): Promise<ResendWebhookRecordResult>
}
