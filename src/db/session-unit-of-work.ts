import type { D1Database } from '@cloudflare/workers-types'

import type { SessionUnitOfWork } from '../application/ports/session-unit-of-work'
import type { EmailDeliveryConfig } from '../application/ports/email-delivery-repository'
import { START_MAIL_BUDGET_POLICY } from '../application/ports/session-unit-of-work'
import { appendEmailDeliveryStatements, prepareEmailDelivery } from './email-delivery-outbox'

/**
 * D1 `batch()` adapter for the frozen SessionUnitOfWork port.
 *
 * Every operation runs in one atomic batch. Redeem/rotate derive the new
 * session's kind/contact/event from the source row (token or current session)
 * inside SQL, so a mismatched session input cannot persist. Conflict is a
 * zero-row guarded consume, never a statement error.
 */
export function createSessionUnitOfWork(
  db: D1Database,
  emailDelivery: EmailDeliveryConfig,
): SessionUnitOfWork {
  return {
    async issueRoleAccess({ token, message, proof, budget }) {
      if (token.purpose === null || token.purpose === 'cfp' || token.formId !== null) {
        throw new Error('issueRoleAccess requires a form-less portal or evaluation token')
      }
      if (token.eventId !== message.eventId) {
        throw new Error('issueRoleAccess token and message must share the same eventId')
      }
      const preparedDelivery = await prepareEmailDelivery(
        { ...message, deliveryBudgetClass: 'organizer' },
        emailDelivery,
      )
      const authorization = roleAccessAuthorization(token.purpose, token.eventId, proof)
      const statements = []
      if (budget !== undefined) {
        if (
          !budget.recipientKey.startsWith('v1:start-recipient:') ||
          !budget.environmentKey.startsWith('v1:mail-environment:')
        ) {
          throw new Error('issueRoleAccess requires purpose-bound budget keys')
        }
        const nowMs = Date.parse(budget.now)
        if (!Number.isFinite(nowMs)) {
          throw new Error('issueRoleAccess requires a valid budget instant')
        }
        const cooldownStart = new Date(
          nowMs - START_MAIL_BUDGET_POLICY.recipientCooldownMs,
        ).toISOString()
        const rollingWindowStart = new Date(
          nowMs - START_MAIL_BUDGET_POLICY.rollingWindowMs,
        ).toISOString()
        statements.push(
          db
            .prepare(
              `INSERT INTO mail_budget_events
                 (operation_id, recipient_key, environment_key, created_at)
               SELECT ?, ?, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM mail_budget_events
                 WHERE recipient_key = ? AND created_at > ? AND created_at <= ?
               )
               AND (
                 SELECT COUNT(*) FROM mail_budget_events
                 WHERE recipient_key = ? AND created_at > ? AND created_at <= ?
               ) < ?
               AND (
                 SELECT COUNT(*) FROM mail_budget_events
                 WHERE environment_key = ? AND created_at > ? AND created_at <= ?
               ) < ?
               AND EXISTS (
                 SELECT 1 FROM contacts c
                 WHERE c.id = ? AND c.email = ? AND ${authorization.sql}
               )
               AND NOT EXISTS (
                 SELECT 1 FROM captured_messages m
                 WHERE ? IS NOT NULL AND m.submission_id = ? AND m.kind = ?
                   AND ((m.recipient_fingerprint = ?) OR
                        (m.recipient_fingerprint IS NULL AND m.to_email = ?))
                   AND m.role_access_token_id IS NOT NULL
               )`,
            )
            .bind(
              budget.operationId,
              budget.recipientKey,
              budget.environmentKey,
              budget.now,
              budget.recipientKey,
              cooldownStart,
              budget.now,
              budget.recipientKey,
              rollingWindowStart,
              budget.now,
              START_MAIL_BUDGET_POLICY.recipientRolling24HourLimit,
              budget.environmentKey,
              rollingWindowStart,
              budget.now,
              START_MAIL_BUDGET_POLICY.environmentRolling24HourLimit,
              token.contactId,
              message.toEmail,
              ...authorization.binds,
              message.submissionId ?? null,
              message.submissionId ?? null,
              message.kind,
              preparedDelivery.recipientFingerprint,
              message.toEmail,
            ),
        )
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO submitter_tokens
               (id, event_id, contact_id, form_id, purpose, token_hash,
                expires_at, consumed_at, created_at)
             SELECT ?, ?, c.id, NULL, ?, ?, ?, NULL, ?
             FROM contacts c
             WHERE c.id = ? AND c.email = ?
               AND ${authorization.sql}
               AND NOT EXISTS (
                 SELECT 1 FROM captured_messages m
                 WHERE ? IS NOT NULL AND m.submission_id = ? AND m.kind = ?
                   AND ((m.recipient_fingerprint = ?) OR
                        (m.recipient_fingerprint IS NULL AND m.to_email = ?))
                   AND m.role_access_token_id IS NOT NULL
               )
               ${budget === undefined ? '' : 'AND EXISTS (SELECT 1 FROM mail_budget_events WHERE operation_id = ?)'}`,
          )
          .bind(
            token.id,
            token.eventId,
            token.purpose,
            token.tokenHash,
            token.expiresAt,
            token.createdAt,
            token.contactId,
            message.toEmail,
            ...authorization.binds,
            message.submissionId ?? null,
            message.submissionId ?? null,
            message.kind,
            preparedDelivery.recipientFingerprint,
            message.toEmail,
            ...(budget === undefined ? [] : [budget.operationId]),
          ),
      )
      const messageResultIndex = statements.length
      statements.push(
        db
          .prepare(
            `INSERT INTO captured_messages
               (id, event_id, to_email, subject, body, created_at, kind, submission_id,
                role_access_token_id, recipient_fingerprint)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM submitter_tokens WHERE id = ?)
             ON CONFLICT DO NOTHING`,
          )
          .bind(
            message.id,
            message.eventId,
            preparedDelivery.recipientLabel,
            message.subject,
            preparedDelivery.auditBody,
            message.createdAt,
            message.kind,
            message.submissionId ?? null,
            token.id,
            preparedDelivery.recipientFingerprint,
            token.id,
          ),
      )
      appendEmailDeliveryStatements(db, statements, preparedDelivery)
      const assertionId = crypto.randomUUID()
      statements.push(
        db
          .prepare(
            `INSERT INTO submit_handoff_assertions (id, valid)
             VALUES (?, CASE
               WHEN NOT EXISTS (SELECT 1 FROM submitter_tokens WHERE id = ?)
                 OR EXISTS (
                   SELECT 1 FROM captured_messages
                   WHERE id = ? AND role_access_token_id = ? AND recipient_fingerprint = ?
                 )
               THEN 1 ELSE 0 END)`,
          )
          .bind(assertionId, token.id, message.id, token.id, preparedDelivery.recipientFingerprint),
      )
      statements.push(
        db.prepare('DELETE FROM submit_handoff_assertions WHERE id = ?').bind(assertionId),
      )
      const results = await db.batch(statements)
      if (budget !== undefined) {
        const reservation = results[0]
        if (reservation === undefined) {
          throw new Error('issueRoleAccess returned no budget result')
        }
        if (reservation.meta.changes !== 1) return { outcome: 'limited' }
      }
      const messageResult = results[messageResultIndex]
      if (messageResult === undefined) throw new Error('issueRoleAccess returned no message result')
      return messageResult.meta.changes === 1 ? { outcome: 'issued' } : { outcome: 'conflict' }
    },

    async issueStart({ contact, token, message, budget }) {
      if (token.eventId !== message.eventId) {
        throw new Error('issueStart token and message must share the same eventId')
      }
      if (
        !budget.recipientKey.startsWith('v1:start-recipient:') ||
        !budget.environmentKey.startsWith('v1:mail-environment:')
      ) {
        throw new Error('issueStart requires purpose-bound budget keys')
      }
      const nowMs = Date.parse(budget.now)
      if (!Number.isFinite(nowMs)) throw new Error('issueStart requires a valid budget instant')
      const cooldownStart = new Date(
        nowMs - START_MAIL_BUDGET_POLICY.recipientCooldownMs,
      ).toISOString()
      const rollingWindowStart = new Date(
        nowMs - START_MAIL_BUDGET_POLICY.rollingWindowMs,
      ).toISOString()
      const preparedDelivery = await prepareEmailDelivery(
        { ...message, deliveryBudgetClass: 'system' },
        emailDelivery,
      )
      const statements = [
        db
          .prepare(
            `INSERT INTO mail_budget_events
               (operation_id, recipient_key, environment_key, created_at)
             SELECT ?, ?, ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM mail_budget_events
               WHERE recipient_key = ? AND created_at > ? AND created_at <= ?
             )
             AND (
               SELECT COUNT(*) FROM mail_budget_events
               WHERE recipient_key = ? AND created_at > ? AND created_at <= ?
             ) < ?
             AND (
               SELECT COUNT(*) FROM mail_budget_events
               WHERE environment_key = ? AND created_at > ? AND created_at <= ?
             ) < ?`,
          )
          .bind(
            budget.operationId,
            budget.recipientKey,
            budget.environmentKey,
            budget.now,
            budget.recipientKey,
            cooldownStart,
            budget.now,
            budget.recipientKey,
            rollingWindowStart,
            budget.now,
            START_MAIL_BUDGET_POLICY.recipientRolling24HourLimit,
            budget.environmentKey,
            rollingWindowStart,
            budget.now,
            START_MAIL_BUDGET_POLICY.environmentRolling24HourLimit,
          ),
        db
          .prepare(
            `INSERT INTO contacts (id, email, name, created_at)
             SELECT ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM mail_budget_events WHERE operation_id = ?
             )
             ON CONFLICT(email) DO NOTHING`,
          )
          .bind(contact.id, contact.email, contact.name, contact.createdAt, budget.operationId),
        db
          .prepare(
            `INSERT INTO submitter_tokens
               (id, event_id, contact_id, form_id, purpose, token_hash, expires_at, consumed_at, created_at)
             SELECT ?, ?, (SELECT id FROM contacts WHERE email = ?), ?, ?, ?, ?, NULL, ?
             WHERE EXISTS (
               SELECT 1 FROM mail_budget_events WHERE operation_id = ?
             )`,
          )
          .bind(
            token.id,
            token.eventId,
            contact.email,
            token.formId,
            token.purpose,
            token.tokenHash,
            token.expiresAt,
            token.createdAt,
            budget.operationId,
          ),
        db
          .prepare(
            `INSERT INTO captured_messages
               (id, event_id, to_email, subject, body, created_at, recipient_fingerprint)
             SELECT ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM mail_budget_events WHERE operation_id = ?
             )`,
          )
          .bind(
            message.id,
            message.eventId,
            preparedDelivery.recipientLabel,
            message.subject,
            preparedDelivery.auditBody,
            message.createdAt,
            preparedDelivery.recipientFingerprint,
            budget.operationId,
          ),
      ]
      appendEmailDeliveryStatements(db, statements, preparedDelivery)
      const results = await db.batch(statements)
      const reservation = results[0]
      if (reservation === undefined) throw new Error('issueStart batch returned no budget result')
      return reservation.meta.changes === 1 ? { outcome: 'issued' } : { outcome: 'limited' }
    },

    async redeemSubmitterToken({ tokenId, consumedAt, session }) {
      if (session.kind !== 'submitter') {
        throw new Error('redeemSubmitterToken requires a submitter session')
      }
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO sessions
               (id, kind, contact_id, event_id, capability, token_hash, expires_at, consumed_at, created_at, provenance)
             SELECT ?, 'submitter', contact_id, event_id, purpose, ?, ?, NULL, ?, ?
             FROM submitter_tokens
             WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
               AND ((purpose IS NULL AND ? IS NULL) OR purpose = ?)`,
          )
          .bind(
            session.id,
            session.tokenHash,
            session.expiresAt,
            session.createdAt,
            session.provenance,
            tokenId,
            consumedAt,
            session.capability,
            session.capability,
          ),
        db
          .prepare(
            `UPDATE submitter_tokens SET consumed_at = ?
             WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
               AND ((purpose IS NULL AND ? IS NULL) OR purpose = ?)`,
          )
          .bind(consumedAt, tokenId, consumedAt, session.capability, session.capability),
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
               (id, kind, contact_id, event_id, capability, token_hash, expires_at, consumed_at, created_at, provenance)
             SELECT ?, kind, contact_id, event_id, capability, ?, ?, NULL, ?, provenance
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

function roleAccessAuthorization(
  purpose: 'portal' | 'evaluation',
  eventId: string,
  proof: import('../application/ports/role-access-issuer').RoleAccessProof,
): { readonly sql: string; readonly binds: readonly (string | null)[] } {
  if (purpose === 'evaluation') {
    if (proof.kind !== 'committee-member') {
      throw new Error('evaluation role access requires committee proof')
    }
    return {
      sql: `EXISTS (
        SELECT 1 FROM evaluation_committee_members cm
        WHERE cm.event_id = ? AND cm.contact_id = c.id
      )`,
      binds: [eventId],
    }
  }
  if (proof.kind !== 'speaker-member') {
    throw new Error('portal role access requires speaker-member proof')
  }
  if (proof.submissionId !== null) {
    return {
      sql: `EXISTS (
        SELECT 1 FROM submission_contributors sc
        WHERE sc.event_id = ? AND sc.contact_id = c.id AND sc.submission_id = ?
      )`,
      binds: [eventId, proof.submissionId],
    }
  }
  return {
    sql: `EXISTS (
      SELECT 1 FROM submission_contributors sc
      WHERE sc.event_id = ? AND sc.contact_id = c.id
      UNION ALL
      SELECT 1 FROM speaker_profiles sp
      WHERE sp.event_id = ? AND sp.contact_id = c.id
    )`,
    binds: [eventId, eventId],
  }
}
