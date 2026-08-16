import type { D1Database } from '@cloudflare/workers-types'

import type {
  EmailDeliveryJob,
  EmailDeliveryRepository,
  EmailDeliveryStatus,
  ProviderEmailStatus,
} from '../application/ports/email-delivery-repository'
import type { EmailDeliveryMode } from '../application/security/mail-payload'

interface RawJobRow {
  readonly id: string
  readonly captured_message_id: string
  readonly event_id: string
  readonly mode: EmailDeliveryMode
  readonly status: EmailDeliveryStatus
  readonly recipient_fingerprint: string
  readonly key_version: string
  readonly nonce: string | null
  readonly ciphertext: string | null
  readonly payload_expires_at: string
  readonly attempts: number
  readonly next_attempt_at: string | null
  readonly lease_owner: string | null
  readonly lease_expires_at: string | null
  readonly provider_id: string | null
  readonly provider_status: ProviderEmailStatus | null
  readonly provider_status_at: string | null
  readonly provider_event_id: string | null
  readonly provider_event_count: number
  readonly last_error_code: string | null
  readonly ambiguous_since: string | null
  readonly accepted_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

const JOB_COLUMNS = `id, captured_message_id, event_id, mode, status,
  recipient_fingerprint, key_version, nonce, ciphertext, payload_expires_at,
  attempts, next_attempt_at, lease_owner, lease_expires_at, provider_id,
  provider_status, provider_status_at, provider_event_id, provider_event_count,
  last_error_code, ambiguous_since, accepted_at, created_at, updated_at`

function toJob(row: RawJobRow): EmailDeliveryJob {
  return {
    jobId: row.id,
    messageId: row.captured_message_id,
    eventId: row.event_id,
    mode: row.mode,
    status: row.status,
    recipientFingerprint: row.recipient_fingerprint,
    recipientLabel: '',
    auditBody: '',
    keyVersion: row.key_version,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
    expiresAt: row.payload_expires_at,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    providerId: row.provider_id,
    providerStatus: row.provider_status,
    providerStatusAt: row.provider_status_at,
    providerEventId: row.provider_event_id,
    providerEventCount: row.provider_event_count,
    lastErrorCode: row.last_error_code,
    ambiguousSince: row.ambiguous_since,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createEmailDeliveryRepository(db: D1Database): EmailDeliveryRepository {
  return {
    async claimBatch({ now, owner, leaseExpiresAt, limit, mode }) {
      const boundedLimit = Math.max(1, Math.min(25, Math.floor(limit)))
      const candidates = await db
        .prepare(
          `SELECT id FROM email_delivery_jobs
           WHERE ciphertext IS NOT NULL
             AND mode = ?
             AND payload_expires_at > ?
             AND (
               (status IN ('queued', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
               OR (status = 'leased' AND lease_expires_at <= ?)
             )
           ORDER BY COALESCE(next_attempt_at, created_at), created_at, id
           LIMIT ?`,
        )
        .bind(mode, now, now, now, boundedLimit)
        .all<{ id: string }>()
      const claimed: EmailDeliveryJob[] = []
      for (const candidate of candidates.results) {
        const result = await db
          .prepare(
            `UPDATE email_delivery_jobs
             SET status = 'leased', lease_owner = ?, lease_expires_at = ?,
                 attempts = attempts + 1, updated_at = ?
             WHERE id = ? AND ciphertext IS NOT NULL AND payload_expires_at > ?
               AND mode = ?
               AND (
                 (status IN ('queued', 'retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
                 OR (status = 'leased' AND lease_expires_at <= ?)
               )`,
          )
          .bind(owner, leaseExpiresAt, now, candidate.id, now, mode, now, now)
          .run()
        if (result.meta.changes !== 1) continue
        const row = await db
          .prepare(`SELECT ${JOB_COLUMNS} FROM email_delivery_jobs WHERE id = ?`)
          .bind(candidate.id)
          .first<RawJobRow>()
        if (row !== null) claimed.push(toJob(row))
      }
      return claimed
    },

    async markAccepted({ id, owner, providerId, at }) {
      await db
        .prepare(
          `UPDATE email_delivery_jobs
           SET status = 'accepted', provider_id = ?, accepted_at = ?,
               provider_status = 'accepted', provider_status_at = ?,
               nonce = NULL, ciphertext = NULL, next_attempt_at = NULL,
               lease_owner = NULL, lease_expires_at = NULL,
               last_error_code = NULL, updated_at = ?
           WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
        )
        .bind(providerId, at, at, at, id, owner)
        .run()
    },

    async markRetry({ id, owner, code, nextAttemptAt, ambiguousSince, at }) {
      await db
        .prepare(
          `UPDATE email_delivery_jobs
           SET status = 'retry', next_attempt_at = ?, last_error_code = ?,
               ambiguous_since = COALESCE(ambiguous_since, ?),
               lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
        )
        .bind(nextAttemptAt, code, ambiguousSince ?? null, at, id, owner)
        .run()
    },

    async markOperatorAction({ id, owner, code, at, clearPayload }) {
      await db
        .prepare(
          `UPDATE email_delivery_jobs
           SET status = 'operator_action', last_error_code = ?, next_attempt_at = NULL,
               lease_owner = NULL, lease_expires_at = NULL,
               nonce = CASE WHEN ? THEN NULL ELSE nonce END,
               ciphertext = CASE WHEN ? THEN NULL ELSE ciphertext END,
               updated_at = ?
           WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
        )
        .bind(code, clearPayload ? 1 : 0, clearPayload ? 1 : 0, at, id, owner)
        .run()
    },

    async expirePayloads(now) {
      const result = await db
        .prepare(
          `UPDATE email_delivery_jobs
           SET nonce = NULL, ciphertext = NULL,
               status = CASE
                 WHEN status IN ('queued', 'retry', 'leased') THEN 'operator_action'
                 ELSE status
               END,
               last_error_code = CASE
                 WHEN status IN ('queued', 'retry', 'leased') THEN 'payload_expired'
                 ELSE last_error_code
               END,
               next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
               updated_at = ?
           WHERE ciphertext IS NOT NULL AND payload_expires_at <= ?`,
        )
        .bind(now, now)
        .run()
      return result.meta.changes
    },

    async findById(id) {
      const row = await db
        .prepare(`SELECT ${JOB_COLUMNS} FROM email_delivery_jobs WHERE id = ?`)
        .bind(id)
        .first<RawJobRow>()
      return row === null ? null : toJob(row)
    },
  }
}
