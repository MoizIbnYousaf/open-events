import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import type {
  DirectSessionBatchInput,
  DirectSessionBatchResult,
  DirectSessionUnitOfWork,
} from '../application/ports/direct-session-unit-of-work'

interface DirectRow {
  readonly id: string
  readonly event_id: string
  readonly owner_contact_id: string
  readonly content_hash: string
}

export function createDirectSessionUnitOfWork(db: D1Database): DirectSessionUnitOfWork {
  return {
    async execute(input: DirectSessionBatchInput): Promise<DirectSessionBatchResult> {
      const answers = JSON.stringify(input.answers)
      const statements: D1PreparedStatement[] = []
      statements.push(
        db
          .prepare(
            `INSERT INTO cfp_forms
               (event_id, id, slug, status, published_version_id, opens_at, closes_at,
                total_cap, per_identity_limit, purpose)
             VALUES (?, ?, '__open_events_direct_sessions__', 'published', ?, NULL, NULL, NULL, NULL, 'direct')
             ON CONFLICT DO NOTHING`,
          )
          .bind(input.eventId, input.formId, input.versionId),
      )
      statements.push(
        db
          .prepare(
            `INSERT INTO cfp_form_versions
               (event_id, id, form_id, version, status, content_hash, published_at, updated_at)
             SELECT ?, ?, ?, 1, 'published', ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM cfp_forms WHERE event_id = ? AND id = ? AND purpose = 'direct'
              )
             ON CONFLICT DO NOTHING`,
          )
          .bind(
            input.eventId,
            input.versionId,
            input.formId,
            '0'.repeat(64),
            input.submittedAt,
            input.submittedAt,
            input.eventId,
            input.formId,
          ),
      )
      const submissionInsertIndex = statements.length
      statements.push(
        db
          .prepare(
            `INSERT INTO proposal_submissions
               (id, event_id, owner_contact_id, form_version_id, origin_draft_id, status,
                title, answers_json, content_hash, routing_json, created_at, submitted_at, source)
             SELECT ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?, ?, 'direct'
              WHERE EXISTS (
                SELECT 1 FROM cfp_form_versions
                 WHERE event_id = ? AND id = ? AND form_id = ? AND status = 'published'
              )
             ON CONFLICT(origin_draft_id) DO NOTHING`,
          )
          .bind(
            input.submissionId,
            input.eventId,
            input.speakerContactId,
            input.versionId,
            input.requestId,
            input.title,
            answers,
            input.contentHash,
            input.submittedAt,
            input.submittedAt,
            input.eventId,
            input.versionId,
            input.formId,
          ),
      )

      const source = `SELECT event_id, id, owner_contact_id
                        FROM proposal_submissions
                       WHERE origin_draft_id = ? AND event_id = ? AND owner_contact_id = ?
                         AND content_hash = ? AND source = 'direct'`
      const sourceBinds = [
        input.requestId,
        input.eventId,
        input.speakerContactId,
        input.contentHash,
      ] as const
      statements.push(
        db
          .prepare(
            `INSERT INTO submission_contributors
               (event_id, submission_id, contact_id, role, position)
             SELECT event_id, id, owner_contact_id, 'primary', 0 FROM (${source}) WHERE true
             ON CONFLICT DO NOTHING`,
          )
          .bind(...sourceBinds),
      )
      statements.push(
        db
          .prepare(
            `INSERT INTO submission_acceptances (event_id, submission_id, accepted_at)
             SELECT event_id, id, ? FROM (${source}) WHERE true
             ON CONFLICT DO NOTHING`,
          )
          .bind(input.submittedAt, ...sourceBinds),
      )
      statements.push(
        db
          .prepare(
            `INSERT INTO submission_decisions
               (event_id, id, submission_id, sequence, outcome, decided_by, decided_at)
             SELECT event_id, ?, id, 1, 'accepted', 'organizer', ? FROM (${source}) WHERE true
             ON CONFLICT DO NOTHING`,
          )
          .bind(input.decisionId, input.submittedAt, ...sourceBinds),
      )
      for (const task of input.tasks) {
        statements.push(
          db
            .prepare(
              `INSERT INTO speaker_tasks
                 (event_id, id, submission_id, contact_id, kind, status, position,
                  created_at, completed_at, form_id, form_version_id, response)
               SELECT event_id, ?, id, owner_contact_id, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL
                 FROM (${source}) WHERE true
               ON CONFLICT DO NOTHING`,
            )
            .bind(task.id, task.kind, task.position, task.createdAt, ...sourceBinds),
        )
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO agenda_sessions
               (event_id, submission_id, track_id, room_id, day, start, end, position,
                status, assignment, created_at, updated_at)
             SELECT event_id, id, ?, NULL, ?, ?, ?, NULL, 'draft', 'unassigned', ?, ?
               FROM (${source}) WHERE true
             ON CONFLICT DO NOTHING`,
          )
          .bind(
            input.session.trackId,
            input.session.day,
            input.session.start,
            input.session.end,
            input.submittedAt,
            input.submittedAt,
            ...sourceBinds,
          ),
      )
      statements.push(
        db
          .prepare(
            `INSERT INTO agenda_session_speakers (event_id, submission_id, contact_id)
             SELECT event_id, id, owner_contact_id FROM (${source}) WHERE true
             ON CONFLICT DO NOTHING`,
          )
          .bind(...sourceBinds),
      )
      const readIndex = statements.length
      statements.push(
        db
          .prepare(
            `SELECT id, event_id, owner_contact_id, content_hash
               FROM proposal_submissions WHERE origin_draft_id = ?`,
          )
          .bind(input.requestId),
      )

      const results = await db.batch(statements)
      const row = results[readIndex]?.results[0] as DirectRow | undefined
      if (row === undefined) return { outcome: 'conflict', submissionId: null }
      if (
        row.event_id !== input.eventId ||
        row.owner_contact_id !== input.speakerContactId ||
        row.content_hash !== input.contentHash
      ) {
        return { outcome: 'conflict', submissionId: null }
      }
      return {
        outcome: results[submissionInsertIndex]?.meta.changes === 1 ? 'created' : 'existing',
        submissionId: row.id,
      }
    },
  }
}
