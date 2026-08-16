import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import type {
  AcceptBatchInput,
  AcceptBatchResult,
  AcceptUnitOfWork,
} from '../application/ports/accept-unit-of-work'
import type { SpeakerTask, SpeakerTaskKind, SpeakerTaskStatus } from '../domain'

interface RawSpeakerTaskRow {
  readonly event_id: string
  readonly id: string
  readonly submission_id: string
  readonly contact_id: string
  readonly kind: SpeakerTaskKind
  readonly status: SpeakerTaskStatus
  readonly position: number
  readonly created_at: string
  readonly completed_at: string | null
}

interface RawAcceptanceRow {
  readonly event_id: string
  readonly submission_id: string
  readonly accepted_at: string
}

function toSpeakerTask(row: RawSpeakerTaskRow): SpeakerTask {
  return {
    id: row.id,
    eventId: row.event_id,
    submissionId: row.submission_id,
    contactId: row.contact_id,
    kind: row.kind,
    status: row.status,
    position: row.position,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    // Acceptance creates checklist tasks only; form tasks are assigned later.
    formId: null,
    formVersionId: null,
    response: null,
  }
}

/**
 * D1 `batch()` adapter for the AcceptUnitOfWork port.
 *
 * One atomic batch: the acceptance insert gated on the submission existing in
 * the event (ON CONFLICT DO NOTHING under UNIQUE(submission_id)), then every
 * checklist insert gated on that acceptance row and de-duplicated by
 * UNIQUE (submission_id, contact_id, kind), then the submission's agenda
 * session (gated on the same acceptance, de-duplicated by its own
 * UNIQUE(submission_id)) and its speaker rows, then same-batch reads of the
 * acceptance and the resulting tasks. Idempotent retries and the unknown
 * submission are zero-row effects mapped from `changes`, never exceptions;
 * any integrity failure aborts the batch so nothing is written.
 */
export function createAcceptUnitOfWork(db: D1Database): AcceptUnitOfWork {
  return {
    async execute(input: AcceptBatchInput): Promise<AcceptBatchResult> {
      for (const task of input.tasks) {
        if (task.eventId !== input.eventId || task.submissionId !== input.submissionId) {
          throw new Error('accept batch tasks must belong to the accepted submission')
        }
      }
      const statements: D1PreparedStatement[] = []

      const acceptanceIndex = statements.length
      statements.push(
        db
          .prepare(
            `INSERT INTO submission_acceptances (event_id, submission_id, accepted_at)
             SELECT ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM proposal_submissions WHERE event_id = ? AND id = ?
             )
             ON CONFLICT DO NOTHING`,
          )
          .bind(
            input.eventId,
            input.submissionId,
            input.acceptedAt,
            input.eventId,
            input.submissionId,
          ),
      )

      for (const task of input.tasks) {
        statements.push(
          db
            .prepare(
              `INSERT INTO speaker_tasks
                 (event_id, id, submission_id, contact_id, kind, status, position,
                  created_at, completed_at)
               SELECT ?, ?, ?, ?, ?, 'pending', ?, ?, NULL
               WHERE EXISTS (
                 SELECT 1 FROM submission_acceptances WHERE event_id = ? AND submission_id = ?
               )
               ON CONFLICT DO NOTHING`,
            )
            .bind(
              task.eventId,
              task.id,
              task.submissionId,
              task.contactId,
              task.kind,
              task.position,
              task.createdAt,
              input.eventId,
              input.submissionId,
            ),
        )
      }

      // The accepted proposal becomes a placeable agenda session in the SAME
      // batch: an unassigned draft with no room/track/position yet. The gate is
      // the acceptance row, so an unknown submission writes nothing here either.
      statements.push(
        db
          .prepare(
            `INSERT INTO agenda_sessions
               (event_id, submission_id, track_id, room_id, day, start, end,
                position, status, assignment, created_at, updated_at)
             SELECT ?, ?, ?, NULL, ?, ?, ?, NULL, 'draft', 'unassigned', ?, ?
             WHERE EXISTS (
               SELECT 1 FROM submission_acceptances WHERE event_id = ? AND submission_id = ?
             )
             ON CONFLICT DO NOTHING`,
          )
          .bind(
            input.eventId,
            input.submissionId,
            input.session.trackId,
            input.session.day,
            input.session.start,
            input.session.end,
            input.acceptedAt,
            input.acceptedAt,
            input.eventId,
            input.submissionId,
          ),
      )

      for (const contactId of input.session.speakerContactIds) {
        statements.push(
          db
            .prepare(
              `INSERT INTO agenda_session_speakers (event_id, submission_id, contact_id)
               SELECT ?, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM agenda_sessions WHERE event_id = ? AND submission_id = ?
               )
               ON CONFLICT DO NOTHING`,
            )
            .bind(input.eventId, input.submissionId, contactId, input.eventId, input.submissionId),
        )
      }

      const readAcceptanceIndex = statements.length
      statements.push(
        db
          .prepare(
            `SELECT event_id, submission_id, accepted_at FROM submission_acceptances
              WHERE event_id = ? AND submission_id = ?`,
          )
          .bind(input.eventId, input.submissionId),
      )

      const readTasksIndex = statements.length
      statements.push(
        db
          .prepare(
            `SELECT event_id, id, submission_id, contact_id, kind, status, position,
                    created_at, completed_at
               FROM speaker_tasks
              WHERE event_id = ? AND submission_id = ?
              ORDER BY submission_id, position`,
          )
          .bind(input.eventId, input.submissionId),
      )

      const results = await db.batch(statements)

      const acceptanceResult = results[acceptanceIndex]
      const readAcceptance = results[readAcceptanceIndex]
      const readTasks = results[readTasksIndex]
      if (
        acceptanceResult === undefined ||
        readAcceptance === undefined ||
        readTasks === undefined
      ) {
        throw new Error('accept batch returned an incomplete result set')
      }

      const acceptanceRow = readAcceptance.results[0] as RawAcceptanceRow | undefined
      if (acceptanceRow === undefined) {
        return { outcome: 'not-found', acceptance: null, tasks: [] }
      }
      const tasks = (readTasks.results as RawSpeakerTaskRow[]).map(toSpeakerTask)
      const acceptance = {
        eventId: acceptanceRow.event_id,
        submissionId: acceptanceRow.submission_id,
        acceptedAt: acceptanceRow.accepted_at,
      }
      return {
        outcome: acceptanceResult.meta.changes === 1 ? 'accepted' : 'already-accepted',
        acceptance,
        tasks,
      }
    },
  }
}
