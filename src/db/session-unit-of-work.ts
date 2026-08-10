import type { D1Database } from '@cloudflare/workers-types'

import type { SessionUnitOfWork } from '../application/ports/session-unit-of-work'

/**
 * D1 `batch()` adapter for the frozen SessionUnitOfWork port.
 *
 * Every operation runs in one atomic batch. Redeem/rotate derive the new
 * session's kind/contact/event from the source row (token or current session)
 * inside SQL, so a mismatched session input cannot persist. Conflict is a
 * zero-row guarded consume, never a statement error.
 */
export function createSessionUnitOfWork(db: D1Database): SessionUnitOfWork {
  return {
    async issueStart({ contact, token, message }) {
      if (token.eventId !== message.eventId) {
        throw new Error('issueStart token and message must share the same eventId')
      }
      await db.batch([
        db
          .prepare(
            `INSERT INTO contacts (id, email, name, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(email) DO NOTHING`,
          )
          .bind(contact.id, contact.email, contact.name, contact.createdAt),
        db
          .prepare(
            `INSERT INTO submitter_tokens
               (id, event_id, contact_id, form_id, token_hash, expires_at, consumed_at, created_at)
             SELECT ?, ?, (SELECT id FROM contacts WHERE email = ?), ?, ?, ?, NULL, ?`,
          )
          .bind(
            token.id,
            token.eventId,
            contact.email,
            token.formId,
            token.tokenHash,
            token.expiresAt,
            token.createdAt,
          ),
        db
          .prepare(
            `INSERT INTO captured_messages (id, event_id, to_email, subject, body, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            message.id,
            message.eventId,
            message.toEmail,
            message.subject,
            message.body,
            message.createdAt,
          ),
      ])
    },

    async redeemSubmitterToken({ tokenId, consumedAt, session }) {
      if (session.kind !== 'submitter') {
        throw new Error('redeemSubmitterToken requires a submitter session')
      }
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO sessions
               (id, kind, contact_id, event_id, token_hash, expires_at, consumed_at, created_at)
             SELECT ?, 'submitter', contact_id, event_id, ?, ?, NULL, ?
             FROM submitter_tokens
             WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`,
          )
          .bind(
            session.id,
            session.tokenHash,
            session.expiresAt,
            session.createdAt,
            tokenId,
            consumedAt,
          ),
        db
          .prepare(
            `UPDATE submitter_tokens SET consumed_at = ?
             WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`,
          )
          .bind(consumedAt, tokenId, consumedAt),
      ])
      const consume = results[1]
      if (consume === undefined) {
        throw new Error('redeemSubmitterToken batch returned no consume result')
      }
      return consume.meta.changes === 1 ? { outcome: 'redeemed' } : { outcome: 'conflict' }
    },

    async rotateSession({ sessionId, consumedAt, rotated }) {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO sessions
               (id, kind, contact_id, event_id, token_hash, expires_at, consumed_at, created_at)
             SELECT ?, kind, contact_id, event_id, ?, ?, NULL, ?
             FROM sessions
             WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`,
          )
          .bind(
            rotated.id,
            rotated.tokenHash,
            rotated.expiresAt,
            rotated.createdAt,
            sessionId,
            consumedAt,
          ),
        db
          .prepare(
            `UPDATE sessions SET consumed_at = ?
             WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`,
          )
          .bind(consumedAt, sessionId, consumedAt),
      ])
      const consume = results[1]
      if (consume === undefined) {
        throw new Error('rotateSession batch returned no consume result')
      }
      return consume.meta.changes === 1 ? { outcome: 'rotated' } : { outcome: 'conflict' }
    },
  }
}
