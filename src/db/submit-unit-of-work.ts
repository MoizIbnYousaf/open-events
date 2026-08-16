import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import type {
  SubmitBatchInput,
  SubmitBatchResult,
  SubmitUnitOfWork,
} from '../application/ports/submit-unit-of-work'
import type { EmailDeliveryConfig } from '../application/ports/email-delivery-repository'
import { MAX_CO_SPEAKERS } from '../domain/contact'
import { toProposalSubmissionFromRaw, type RawProposalSubmissionRow } from './mappers'
import { appendEmailDeliveryStatements, prepareEmailDelivery } from './email-delivery-outbox'

/**
 * D1 `batch()` adapter for the frozen SubmitUnitOfWork port.
 *
 * One atomic batch: gated co-speaker contact upserts, gated submission insert
 * under the global UNIQUE(origin_draft_id) with ON CONFLICT DO NOTHING,
 * EXISTS-guarded contributors/message/confirmation/draft-delete, and a
 * same-batch existing-row read plus gate-reason diagnostic. Gate outcomes are
 * zero-row effects mapped from per-statement `changes` — never exceptions —
 * so rejections and idempotent retries never abort or write.
 */
export function createSubmitUnitOfWork(
  db: D1Database,
  emailDelivery: EmailDeliveryConfig,
): SubmitUnitOfWork {
  return {
    async recoverHandoff(input) {
      const row = await db
        .prepare(
          `SELECT ps.id, ps.event_id, ps.owner_contact_id, ps.form_version_id,
                  ps.origin_draft_id, ps.status, ps.title, ps.answers_json,
                  ps.content_hash, ps.routing_json, ps.created_at, ps.submitted_at,
                  s.id AS portal_session_id, s.expires_at AS portal_expires_at
           FROM submit_session_handoffs h
           JOIN proposal_submissions ps ON ps.id = h.submission_id
           JOIN sessions s ON s.id = h.portal_session_id
           WHERE h.cfp_session_id = ? AND h.event_id = ? AND h.contact_id = ?
             AND h.origin_draft_id = ? AND h.request_hash = ?
             AND ps.event_id = h.event_id AND ps.owner_contact_id = h.contact_id
             AND s.kind = 'submitter' AND s.capability = 'portal'
             AND s.contact_id = h.contact_id AND s.event_id = h.event_id`,
        )
        .bind(
          input.cfpSessionId,
          input.eventId,
          input.ownerContactId,
          input.originDraftId,
          input.requestHash,
        )
        .first<
          RawProposalSubmissionRow & { portal_session_id: string; portal_expires_at: string }
        >()
      if (row === null) return { outcome: 'handoff-invalid' }
      return {
        outcome: 'existing-idempotent',
        submission: toProposalSubmissionFromRaw(row),
        handoff: { portalSessionId: row.portal_session_id, expiresAt: row.portal_expires_at },
      }
    },

    async execute(input: SubmitBatchInput): Promise<SubmitBatchResult> {
      if (input.coSpeakers.length > MAX_CO_SPEAKERS) {
        throw new Error(`A submission may include at most ${MAX_CO_SPEAKERS} co-speakers`)
      }
      if (input.message.eventId !== input.eventId) {
        throw new Error('submit message must belong to the actor event')
      }
      if (input.confirmation.eventId !== input.eventId) {
        throw new Error('submit confirmation must belong to the actor event')
      }
      const preparedDelivery = await prepareEmailDelivery(
        { ...input.message, deliveryBudgetClass: 'system' },
        emailDelivery,
      )
      const statements: D1PreparedStatement[] = []
      const gate = gateSql(input)
      let sourceValidityIndex: number | null = null
      if (input.handoff !== undefined) {
        const sourceGate = handoffSourceGate(input.handoff.source, input.submittedAt)
        sourceValidityIndex = statements.length
        statements.push(
          db
            .prepare(
              `SELECT 1 AS valid FROM sessions s
               WHERE s.id = ? AND s.kind = 'submitter' AND ${sourceGate.sql}
                 AND s.contact_id = ? AND s.event_id = ?
                 AND s.consumed_at IS NULL AND s.expires_at > ?`,
            )
            .bind(
              input.handoff.cfpSessionId,
              ...sourceGate.binds,
              input.ownerContactId,
              input.eventId,
              input.submittedAt,
            ),
        )
      }

      for (const coSpeaker of input.coSpeakers) {
        statements.push(
          db
            .prepare(
              `INSERT INTO contacts (id, email, name, created_at)
               SELECT ?, ?, ?, ?
               WHERE ${gate.sql}
                 AND NOT EXISTS (SELECT 1 FROM proposal_submissions WHERE origin_draft_id = ?)
                 AND NOT EXISTS (SELECT 1 FROM contacts WHERE email = ?)
               ON CONFLICT(email) DO NOTHING`,
            )
            .bind(
              crypto.randomUUID(),
              coSpeaker.email,
              coSpeaker.name,
              input.submittedAt,
              ...gate.binds,
              input.originDraftId,
              coSpeaker.email,
            ),
        )
      }

      const submissionIndex = statements.length
      const submission = input.submission
      statements.push(
        db
          .prepare(
            `INSERT INTO proposal_submissions
               (id, event_id, owner_contact_id, form_version_id, origin_draft_id,
                status, title, answers_json, content_hash, routing_json, created_at, submitted_at)
             SELECT ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?
             WHERE ${gate.sql}
             ON CONFLICT(origin_draft_id) DO NOTHING`,
          )
          .bind(
            submission.id,
            input.eventId,
            input.ownerContactId,
            submission.formVersionId,
            input.originDraftId,
            submission.title,
            JSON.stringify(submission.answers),
            submission.contentHash,
            submission.routing === null ? null : JSON.stringify(submission.routing),
            submission.createdAt,
            submission.submittedAt,
            ...gate.binds,
          ),
      )

      statements.push(
        db
          .prepare(
            `INSERT INTO submission_contributors (event_id, submission_id, contact_id, role, position)
             SELECT ?, ?, ?, 'primary', 0
             WHERE EXISTS (SELECT 1 FROM proposal_submissions WHERE id = ? AND event_id = ?)`,
          )
          .bind(input.eventId, submission.id, input.ownerContactId, submission.id, input.eventId),
      )

      for (const [index, coSpeaker] of input.coSpeakers.entries()) {
        statements.push(
          db
            .prepare(
              `INSERT INTO submission_contributors (event_id, submission_id, contact_id, role, position)
               SELECT ?, ?, (SELECT id FROM contacts WHERE email = ?), 'co-speaker', ?
               WHERE EXISTS (SELECT 1 FROM proposal_submissions WHERE id = ? AND event_id = ?)`,
            )
            .bind(
              input.eventId,
              submission.id,
              coSpeaker.email,
              index + 1,
              submission.id,
              input.eventId,
            ),
        )
      }

      statements.push(
        db
          .prepare(
            `INSERT INTO captured_messages
               (id, event_id, to_email, subject, body, created_at, recipient_fingerprint)
             SELECT ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM proposal_submissions WHERE id = ? AND event_id = ?)`,
          )
          .bind(
            input.message.id,
            input.message.eventId,
            preparedDelivery.recipientLabel,
            input.message.subject,
            preparedDelivery.auditBody,
            input.message.createdAt,
            preparedDelivery.recipientFingerprint,
            submission.id,
            input.eventId,
          ),
      )
      appendEmailDeliveryStatements(db, statements, preparedDelivery)

      statements.push(
        db
          .prepare(
            `INSERT INTO confirmation_records
               (id, event_id, submission_id, captured_message_id, created_at)
             SELECT ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM proposal_submissions WHERE id = ? AND event_id = ?)`,
          )
          .bind(
            input.confirmation.id,
            input.confirmation.eventId,
            input.confirmation.submissionId,
            input.confirmation.capturedMessageId,
            input.confirmation.createdAt,
            submission.id,
            input.eventId,
          ),
      )

      statements.push(
        db
          .prepare(
            `DELETE FROM proposal_drafts
             WHERE event_id = ? AND id = ?
               AND EXISTS (SELECT 1 FROM proposal_submissions WHERE id = ? AND event_id = ?)`,
          )
          .bind(input.eventId, input.originDraftId, submission.id, input.eventId),
      )

      let handoffIndex: number | null = null
      if (input.handoff !== undefined) {
        const handoff = input.handoff
        const sourceGate = handoffSourceGate(handoff.source, input.submittedAt)
        const consumedSourceGate = handoffSourceGate(handoff.source, input.submittedAt, 'sessions')
        statements.push(
          db
            .prepare(
              `INSERT INTO sessions
                 (id, kind, contact_id, event_id, capability, token_hash,
                  expires_at, consumed_at, created_at)
               SELECT ?, 'submitter', s.contact_id, s.event_id, 'portal', ?, ?, NULL, ?
               FROM sessions s
               WHERE s.id = ? AND s.kind = 'submitter' AND ${sourceGate.sql}
                 AND s.consumed_at IS NULL AND s.expires_at > ?
                 AND s.contact_id = ? AND s.event_id = ?
                 AND EXISTS (
                   SELECT 1 FROM proposal_submissions ps
                   WHERE ps.id = ? AND ps.origin_draft_id = ?
                     AND ps.owner_contact_id = s.contact_id AND ps.event_id = s.event_id
                 )
               ON CONFLICT(id) DO NOTHING`,
            )
            .bind(
              handoff.portalSession.id,
              handoff.portalSession.tokenHash,
              handoff.portalSession.expiresAt,
              handoff.portalSession.createdAt,
              handoff.cfpSessionId,
              ...sourceGate.binds,
              input.submittedAt,
              input.ownerContactId,
              input.eventId,
              submission.id,
              input.originDraftId,
            ),
        )
        statements.push(
          db
            .prepare(
              `INSERT INTO submit_session_handoffs
                 (cfp_session_id, event_id, contact_id, origin_draft_id, request_hash,
                  submission_id, portal_session_id, created_at)
               SELECT s.id, s.event_id, s.contact_id, ?, ?, ?, ?, ?
               FROM sessions s
               WHERE s.id = ? AND s.kind = 'submitter' AND ${sourceGate.sql}
                 AND s.consumed_at IS NULL AND s.expires_at > ?
                 AND s.contact_id = ? AND s.event_id = ?
                 AND EXISTS (
                   SELECT 1 FROM sessions p
                   WHERE p.id = ? AND p.kind = 'submitter' AND p.capability = 'portal'
                     AND p.contact_id = s.contact_id AND p.event_id = s.event_id
                 )
                 AND EXISTS (
                   SELECT 1 FROM proposal_submissions ps
                   WHERE ps.id = ? AND ps.origin_draft_id = ?
                     AND ps.owner_contact_id = s.contact_id AND ps.event_id = s.event_id
                 )
               ON CONFLICT(cfp_session_id) DO NOTHING`,
            )
            .bind(
              input.originDraftId,
              handoff.requestHash,
              submission.id,
              handoff.portalSession.id,
              input.submittedAt,
              handoff.cfpSessionId,
              ...sourceGate.binds,
              input.submittedAt,
              input.ownerContactId,
              input.eventId,
              handoff.portalSession.id,
              submission.id,
              input.originDraftId,
            ),
        )
        statements.push(
          db
            .prepare(
              `UPDATE sessions SET consumed_at = ?
               WHERE id = ? AND kind = 'submitter' AND ${consumedSourceGate.sql}
                 AND consumed_at IS NULL AND expires_at > ?
                 AND EXISTS (
                   SELECT 1 FROM submit_session_handoffs h
                   WHERE h.cfp_session_id = sessions.id AND h.origin_draft_id = ?
                     AND h.request_hash = ? AND h.portal_session_id = ?
                 )`,
            )
            .bind(
              input.submittedAt,
              handoff.cfpSessionId,
              ...consumedSourceGate.binds,
              input.submittedAt,
              input.originDraftId,
              handoff.requestHash,
              handoff.portalSession.id,
            ),
        )
        const assertionId = crypto.randomUUID()
        statements.push(
          db
            .prepare(
              `INSERT INTO submit_handoff_assertions (id, valid)
               VALUES (?, CASE
                 WHEN NOT EXISTS (SELECT 1 FROM proposal_submissions WHERE id = ?)
                   OR EXISTS (
                     SELECT 1 FROM submit_session_handoffs h
                     WHERE h.cfp_session_id = ? AND h.event_id = ? AND h.contact_id = ?
                       AND h.origin_draft_id = ? AND h.request_hash = ?
                       AND h.portal_session_id = ?
                   )
                 THEN 1 ELSE 0 END)`,
            )
            .bind(
              assertionId,
              submission.id,
              handoff.cfpSessionId,
              input.eventId,
              input.ownerContactId,
              input.originDraftId,
              handoff.requestHash,
              handoff.portalSession.id,
            ),
        )
        statements.push(
          db.prepare('DELETE FROM submit_handoff_assertions WHERE id = ?').bind(assertionId),
        )
        handoffIndex = statements.length
        statements.push(
          db
            .prepare(
              `SELECT s.id AS portal_session_id, s.expires_at AS portal_expires_at
               FROM submit_session_handoffs h
               JOIN sessions s ON s.id = h.portal_session_id
               WHERE h.cfp_session_id = ? AND h.event_id = ? AND h.contact_id = ?
                 AND h.origin_draft_id = ? AND h.request_hash = ?
                 AND h.portal_session_id = ? AND s.capability = 'portal'`,
            )
            .bind(
              handoff.cfpSessionId,
              input.eventId,
              input.ownerContactId,
              input.originDraftId,
              handoff.requestHash,
              handoff.portalSession.id,
            ),
        )
      }

      const existingIndex = statements.length
      statements.push(
        db
          .prepare(
            `SELECT id, event_id, owner_contact_id, form_version_id, origin_draft_id,
                    status, title, answers_json, content_hash, routing_json,
                    created_at, submitted_at
             FROM proposal_submissions WHERE origin_draft_id = ?`,
          )
          .bind(input.originDraftId),
      )

      const reasonIndex = statements.length
      statements.push(
        db
          .prepare(
            `SELECT CASE
               WHEN NOT (f.status = 'published' AND f.published_version_id = ?) THEN 'closed'
               WHEN (f.opens_at IS NOT NULL AND ? < f.opens_at) THEN 'closed'
               WHEN (f.closes_at IS NOT NULL AND ? >= f.closes_at) THEN 'closed'
               WHEN f.total_cap IS NOT NULL AND (
                 SELECT COUNT(*) FROM proposal_submissions ps
                   JOIN cfp_form_versions v
                     ON v.event_id = ps.event_id AND v.id = ps.form_version_id
                  WHERE ps.event_id = f.event_id AND v.form_id = f.id
               ) >= f.total_cap THEN 'capped'
               WHEN f.per_identity_limit IS NOT NULL AND (
                 SELECT COUNT(*) FROM proposal_submissions ps
                   JOIN cfp_form_versions v
                     ON v.event_id = ps.event_id AND v.id = ps.form_version_id
                  WHERE ps.event_id = f.event_id AND v.form_id = f.id
                    AND ps.owner_contact_id = ?
               ) >= f.per_identity_limit THEN 'identity-limited'
               ELSE 'unexpected'
             END AS gate_reason
             FROM cfp_forms f WHERE f.event_id = ? AND f.id = ?`,
          )
          .bind(
            submission.formVersionId,
            input.submittedAt,
            input.submittedAt,
            input.ownerContactId,
            input.eventId,
            input.formId,
          ),
      )

      const results = await db.batch(statements)

      const resolvedHandoff = (() => {
        if (handoffIndex === null) return undefined
        const result = results[handoffIndex]
        const row = result?.results[0] as
          { portal_session_id?: unknown; portal_expires_at?: unknown } | undefined
        return typeof row?.portal_session_id === 'string' &&
          typeof row.portal_expires_at === 'string'
          ? { portalSessionId: row.portal_session_id, expiresAt: row.portal_expires_at }
          : null
      })()

      const submissionResult = results[submissionIndex]
      if (submissionResult === undefined) {
        throw new Error('submit batch returned no submission result')
      }
      if (submissionResult.meta.changes === 1) {
        if (resolvedHandoff === null) {
          throw new Error('submit batch inserted business state without its portal handoff')
        }
        return {
          outcome: 'inserted',
          submission,
          ...(resolvedHandoff === undefined ? {} : { handoff: resolvedHandoff }),
        }
      }

      const existingResult = results[existingIndex]
      if (existingResult === undefined) {
        throw new Error('submit batch returned no existing-row result')
      }
      const existingRow = existingResult.results[0] as RawProposalSubmissionRow | undefined
      if (existingRow !== undefined) {
        if (resolvedHandoff === null) return { outcome: 'handoff-invalid' }
        return {
          outcome: 'existing-idempotent',
          submission: toProposalSubmissionFromRaw(existingRow),
          ...(resolvedHandoff === undefined ? {} : { handoff: resolvedHandoff }),
        }
      }

      const sourceWasValid =
        sourceValidityIndex === null || results[sourceValidityIndex]?.results[0] !== undefined
      if (!sourceWasValid) {
        return { outcome: 'handoff-invalid' }
      }

      const reasonResult = results[reasonIndex]
      if (reasonResult === undefined) {
        throw new Error('submit batch returned no gate-reason result')
      }
      const reason = (reasonResult.results[0] as { gate_reason?: unknown } | undefined)?.gate_reason
      switch (reason) {
        case 'closed':
          return { outcome: 'closed' }
        case 'capped':
          return { outcome: 'capped' }
        case 'identity-limited':
          return { outcome: 'identity-limited' }
        default:
          throw new Error(`submit gate resolved to unexpected reason '${String(reason)}'`)
      }
    },
  }
}

interface GateSql {
  readonly sql: string
  readonly binds: readonly string[]
}

function handoffSourceGate(
  source: NonNullable<SubmitBatchInput['handoff']>['source'],
  submittedAt: string,
  alias = 's',
): GateSql {
  switch (source.kind) {
    case 'cfp':
      return { sql: `${alias}.capability = 'cfp'`, binds: [] }
    case 'legacy-rollout':
      return {
        sql: `${alias}.capability IS NULL AND ${alias}.created_at <= ?`,
        binds: [submittedAt],
      }
    case 'legacy-bounded':
      return {
        sql: `${alias}.capability IS NULL AND ${alias}.created_at <= ? AND ? <= ?`,
        binds: [source.lastLegacyWriterCutoff, submittedAt, source.compatibilityEndsAt],
      }
  }
}

function gateSql(input: SubmitBatchInput): GateSql {
  const handoffSource =
    input.handoff === undefined ? null : handoffSourceGate(input.handoff.source, input.submittedAt)
  const sessionGate =
    input.handoff === undefined
      ? ''
      : ` AND EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.id = ? AND s.kind = 'submitter' AND ${handoffSource?.sql ?? '0'}
          AND s.contact_id = ? AND s.event_id = ?
          AND s.consumed_at IS NULL AND s.expires_at > ?
      )`
  return {
    sql: `EXISTS (
      SELECT 1 FROM cfp_forms f
      WHERE f.event_id = ? AND f.id = ?
        AND f.status = 'published' AND f.published_version_id = ?
        AND (f.opens_at IS NULL OR ? >= f.opens_at)
        AND (f.closes_at IS NULL OR ? < f.closes_at)
        AND (f.total_cap IS NULL OR (
          SELECT COUNT(*) FROM proposal_submissions ps
            JOIN cfp_form_versions v
              ON v.event_id = ps.event_id AND v.id = ps.form_version_id
           WHERE ps.event_id = f.event_id AND v.form_id = f.id
        ) < f.total_cap)
        AND (f.per_identity_limit IS NULL OR (
          SELECT COUNT(*) FROM proposal_submissions ps
            JOIN cfp_form_versions v
              ON v.event_id = ps.event_id AND v.id = ps.form_version_id
           WHERE ps.event_id = f.event_id AND v.form_id = f.id
             AND ps.owner_contact_id = ?
        ) < f.per_identity_limit)
    )${sessionGate}`,
    binds: [
      input.eventId,
      input.formId,
      input.submission.formVersionId,
      input.submittedAt,
      input.submittedAt,
      input.ownerContactId,
      ...(input.handoff === undefined
        ? []
        : [
            input.handoff.cfpSessionId,
            ...(handoffSource?.binds ?? []),
            input.ownerContactId,
            input.eventId,
            input.submittedAt,
          ]),
    ],
  }
}
