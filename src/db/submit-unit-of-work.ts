import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import type {
  SubmitBatchInput,
  SubmitBatchResult,
  SubmitUnitOfWork,
} from '../application/ports/submit-unit-of-work'
import { MAX_CO_SPEAKERS } from '../domain/contact'
import { toProposalSubmissionFromRaw, type RawProposalSubmissionRow } from './mappers'

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
export function createSubmitUnitOfWork(db: D1Database): SubmitUnitOfWork {
  return {
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
      const statements: D1PreparedStatement[] = []
      const gate = gateSql(input)

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
            `INSERT INTO captured_messages (id, event_id, to_email, subject, body, created_at)
             SELECT ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM proposal_submissions WHERE id = ? AND event_id = ?)`,
          )
          .bind(
            input.message.id,
            input.message.eventId,
            input.message.toEmail,
            input.message.subject,
            input.message.body,
            input.message.createdAt,
            submission.id,
            input.eventId,
          ),
      )

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

      const submissionResult = results[submissionIndex]
      if (submissionResult === undefined) {
        throw new Error('submit batch returned no submission result')
      }
      if (submissionResult.meta.changes === 1) {
        return { outcome: 'inserted', submission }
      }

      const existingResult = results[existingIndex]
      if (existingResult === undefined) {
        throw new Error('submit batch returned no existing-row result')
      }
      const existingRow = existingResult.results[0] as RawProposalSubmissionRow | undefined
      if (existingRow !== undefined) {
        return {
          outcome: 'existing-idempotent',
          submission: toProposalSubmissionFromRaw(existingRow),
        }
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

function gateSql(input: SubmitBatchInput): GateSql {
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
    )`,
    binds: [
      input.eventId,
      input.formId,
      input.submission.formVersionId,
      input.submittedAt,
      input.submittedAt,
      input.ownerContactId,
    ],
  }
}
