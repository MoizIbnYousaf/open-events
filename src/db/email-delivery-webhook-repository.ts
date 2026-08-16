import type { D1Database } from '@cloudflare/workers-types'

import type {
  EmailDeliveryWebhookRepository,
  ResendDeliveryEvent,
  ResendDeliveryEventType,
} from '../application/ports/email-delivery-webhook-repository'
import { projectEmailDeliveryEvents } from '../application/services/email-delivery-webhook'

interface StoredWebhookEventRow {
  readonly id: string
  readonly job_id: string | null
  readonly provider_email_id: string
  readonly event_type: ResendDeliveryEventType
  readonly event_created_at: string
  readonly received_at: string
}

function toEvent(row: StoredWebhookEventRow): ResendDeliveryEvent {
  return {
    id: row.id,
    providerEmailId: row.provider_email_id,
    jobTag: null,
    type: row.event_type,
    createdAt: row.event_created_at,
    receivedAt: row.received_at,
  }
}

export function createEmailDeliveryWebhookRepository(
  db: D1Database,
): EmailDeliveryWebhookRepository {
  return {
    async record(event) {
      const insert = await db
        .prepare(
          `INSERT INTO resend_webhook_events
             (id, job_id, provider_email_id, event_type, event_created_at, received_at)
           VALUES (
             ?,
             COALESCE(
               (SELECT id FROM email_delivery_jobs WHERE provider_id = ?),
               (SELECT id FROM email_delivery_jobs
                WHERE id = ? AND mode != 'capture'
                  AND (provider_id IS NULL OR provider_id = ?))
             ),
             ?, ?, ?, ?
           )
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          event.id,
          event.providerEmailId,
          event.jobTag,
          event.providerEmailId,
          event.providerEmailId,
          event.type,
          event.createdAt,
          event.receivedAt,
        )
        .run()

      const stored = await db
        .prepare(
          `SELECT id, job_id, provider_email_id, event_type, event_created_at, received_at
           FROM resend_webhook_events WHERE id = ?`,
        )
        .bind(event.id)
        .first<StoredWebhookEventRow>()
      if (stored === null) throw new Error('Webhook evidence insert was not readable')
      if (stored.job_id === null) {
        return { inserted: insert.meta.changes === 1, matched: false, status: null }
      }

      const accepted = await db
        .prepare(
          `UPDATE email_delivery_jobs
           SET provider_id = COALESCE(provider_id, ?), status = 'accepted',
               accepted_at = COALESCE(accepted_at, ?),
               nonce = NULL, ciphertext = NULL, next_attempt_at = NULL,
               lease_owner = NULL, lease_expires_at = NULL,
               last_error_code = NULL, updated_at = ?
           WHERE id = ? AND mode != 'capture'
             AND (provider_id IS NULL OR provider_id = ?)`,
        )
        .bind(
          stored.provider_email_id,
          stored.received_at,
          stored.received_at,
          stored.job_id,
          stored.provider_email_id,
        )
        .run()
      if (accepted.meta.changes !== 1) {
        throw new Error('Webhook provider correlation conflict')
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const rows = await db
          .prepare(
            `SELECT id, job_id, provider_email_id, event_type, event_created_at, received_at
             FROM resend_webhook_events
             WHERE job_id = ?
             ORDER BY event_created_at, id`,
          )
          .bind(stored.job_id)
          .all<StoredWebhookEventRow>()
        const projection = projectEmailDeliveryEvents(rows.results.map(toEvent))
        const update = await db
          .prepare(
            `UPDATE email_delivery_jobs
             SET provider_status = ?, provider_status_at = ?, provider_event_id = ?,
                 provider_event_count = ?, updated_at = ?
             WHERE id = ? AND (
               SELECT COUNT(*) FROM resend_webhook_events WHERE job_id = ?
             ) = ?`,
          )
          .bind(
            projection.status,
            projection.at,
            projection.eventId,
            rows.results.length,
            stored.received_at,
            stored.job_id,
            stored.job_id,
            rows.results.length,
          )
          .run()
        if (update.meta.changes === 1) {
          return {
            inserted: insert.meta.changes === 1,
            matched: true,
            status: projection.status,
          }
        }
      }
      throw new Error('Webhook projection did not converge')
    },
  }
}
