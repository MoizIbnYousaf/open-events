import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import type { EmailDeliveryConfig } from '../application/ports/email-delivery-repository'
import { protectMailPayload } from '../application/security/mail-payload'
import type { CapturedMessage, UtcInstant } from '../domain'

export const EMAIL_GLOBAL_ROLLING_24_HOUR_LIMIT = 250
export const EMAIL_ORGANIZER_ROLLING_24_HOUR_LIMIT = 100
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000

export interface PreparedEmailDelivery {
  readonly rawMessage: CapturedMessage
  readonly jobId: string
  readonly recipientFingerprint: string
  readonly recipientLabel: string
  readonly auditBody: string
  readonly mode: EmailDeliveryConfig['mode']
  readonly keyVersion: string
  readonly nonce: string
  readonly ciphertext: string
  readonly payloadExpiresAt: UtcInstant
  readonly environmentKey: string
  readonly organizerKey: string | null
}

export async function prepareEmailDelivery(
  message: CapturedMessage,
  config: EmailDeliveryConfig,
): Promise<PreparedEmailDelivery> {
  const createdAtMs = Date.parse(message.createdAt)
  if (!Number.isFinite(createdAtMs)) throw new Error('Invalid captured message instant')
  if (
    !Number.isSafeInteger(config.payloadRetentionMs) ||
    config.payloadRetentionMs < 1 ||
    config.payloadRetentionMs > 30 * 24 * 60 * 60 * 1000
  ) {
    throw new Error('Invalid mail payload retention')
  }
  if (config.environmentKey.trim() === '') throw new Error('Invalid email delivery environment')
  const payloadExpiresAt = new Date(createdAtMs + config.payloadRetentionMs).toISOString()
  const payload = await protectMailPayload(
    {
      jobId: message.id,
      messageId: message.id,
      mode: config.mode,
      to: message.toEmail,
      subject: message.subject,
      body: message.body,
      expiresAt: payloadExpiresAt,
    },
    config.payloadKey,
  )
  return {
    rawMessage: message,
    jobId: message.id,
    recipientFingerprint: payload.recipientFingerprint,
    recipientLabel: payload.recipientLabel,
    auditBody: payload.auditBody,
    mode: config.mode,
    keyVersion: payload.keyVersion,
    nonce: payload.nonce,
    ciphertext: payload.ciphertext,
    payloadExpiresAt,
    environmentKey: config.environmentKey,
    organizerKey:
      message.deliveryBudgetClass === 'organizer'
        ? `${config.environmentKey}:event:${message.eventId}`
        : null,
  }
}

/**
 * Appends the provider budget and one-to-one job statements after the caller's
 * captured-message insert. The message-id guard means a rejected/idempotent
 * business write cannot create a detached job.
 */
export function appendEmailDeliveryStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
  delivery: PreparedEmailDelivery,
): void {
  const now = delivery.rawMessage.createdAt
  const rollingWindowStart = new Date(Date.parse(now) - ROLLING_WINDOW_MS).toISOString()
  statements.push(
    db
      .prepare(
        `INSERT INTO email_delivery_jobs
           (id, captured_message_id, event_id, mode, status, recipient_fingerprint,
            key_version, nonce, ciphertext, payload_expires_at, attempts,
            next_attempt_at, created_at, updated_at, last_error_code)
         SELECT ?, ?, ?, ?,
           CASE
             WHEN ? = 'capture' THEN 'captured'
             WHEN (
               SELECT COUNT(*) FROM email_delivery_budget_events
               WHERE environment_key = ? AND created_at > ? AND created_at <= ?
             ) >= ? THEN 'operator_action'
             WHEN ? IS NOT NULL AND (
               SELECT COUNT(*) FROM email_delivery_budget_events
               WHERE organizer_key = ? AND created_at > ? AND created_at <= ?
             ) >= ? THEN 'operator_action'
             ELSE 'queued'
           END,
           ?, ?, ?, ?, ?, 0,
           CASE WHEN ? = 'capture' THEN NULL ELSE ? END,
           ?, ?,
           CASE
             WHEN ? = 'capture' THEN NULL
             WHEN (
               SELECT COUNT(*) FROM email_delivery_budget_events
               WHERE environment_key = ? AND created_at > ? AND created_at <= ?
             ) >= ? THEN 'global_budget_exhausted'
             WHEN ? IS NOT NULL AND (
               SELECT COUNT(*) FROM email_delivery_budget_events
               WHERE organizer_key = ? AND created_at > ? AND created_at <= ?
             ) >= ? THEN 'organizer_budget_exhausted'
             ELSE NULL
           END
         WHERE EXISTS (SELECT 1 FROM captured_messages WHERE id = ?)
           AND NOT EXISTS (SELECT 1 FROM email_delivery_jobs WHERE captured_message_id = ?)`,
      )
      .bind(
        delivery.jobId,
        delivery.rawMessage.id,
        delivery.rawMessage.eventId,
        delivery.mode,
        delivery.mode,
        delivery.environmentKey,
        rollingWindowStart,
        now,
        EMAIL_GLOBAL_ROLLING_24_HOUR_LIMIT,
        delivery.organizerKey,
        delivery.organizerKey,
        rollingWindowStart,
        now,
        EMAIL_ORGANIZER_ROLLING_24_HOUR_LIMIT,
        delivery.recipientFingerprint,
        delivery.keyVersion,
        delivery.nonce,
        delivery.ciphertext,
        delivery.payloadExpiresAt,
        delivery.mode,
        now,
        now,
        now,
        delivery.mode,
        delivery.environmentKey,
        rollingWindowStart,
        now,
        EMAIL_GLOBAL_ROLLING_24_HOUR_LIMIT,
        delivery.organizerKey,
        delivery.organizerKey,
        rollingWindowStart,
        now,
        EMAIL_ORGANIZER_ROLLING_24_HOUR_LIMIT,
        delivery.rawMessage.id,
        delivery.rawMessage.id,
      ),
  )
  statements.push(
    db
      .prepare(
        `INSERT INTO email_delivery_budget_events
           (job_id, environment_key, organizer_key, created_at)
         SELECT id, ?, ?, ? FROM email_delivery_jobs
         WHERE id = ? AND status = 'queued'
         ON CONFLICT(job_id) DO NOTHING`,
      )
      .bind(delivery.environmentKey, delivery.organizerKey, now, delivery.jobId),
  )
}
