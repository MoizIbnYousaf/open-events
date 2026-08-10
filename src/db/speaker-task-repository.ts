import type { D1Database } from '@cloudflare/workers-types'

import type { SpeakerTaskRepository } from '../application/ports/speaker-task-repository'
import type {
  SpeakerTask,
  SpeakerTaskKind,
  SpeakerTaskStatus,
  SubmissionAcceptance,
} from '../domain'

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

const TASK_COLUMNS = `event_id, id, submission_id, contact_id, kind, status, position,
                created_at, completed_at`

const TASK_ORDER = 'ORDER BY submission_id, position'

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
  }
}

function toAcceptance(row: RawAcceptanceRow): SubmissionAcceptance {
  return {
    eventId: row.event_id,
    submissionId: row.submission_id,
    acceptedAt: row.accepted_at,
  }
}

/** D1 adapter for the frozen `SpeakerTaskRepository` port (migration 0007). */
export function createSpeakerTaskRepository(db: D1Database): SpeakerTaskRepository {
  async function listTasks(sql: string, binds: readonly string[]): Promise<readonly SpeakerTask[]> {
    const result = await db
      .prepare(sql)
      .bind(...binds)
      .all<RawSpeakerTaskRow>()
    return result.results.map(toSpeakerTask)
  }

  return {
    async findById(id: string): Promise<SpeakerTask | null> {
      const row = await db
        .prepare(`SELECT ${TASK_COLUMNS} FROM speaker_tasks WHERE id = ?`)
        .bind(id)
        .first<RawSpeakerTaskRow>()
      return row === null ? null : toSpeakerTask(row)
    },

    async listByEvent(eventId: string): Promise<readonly SpeakerTask[]> {
      return listTasks(
        `SELECT ${TASK_COLUMNS} FROM speaker_tasks WHERE event_id = ? ${TASK_ORDER}`,
        [eventId],
      )
    },

    async listByContact(eventId: string, contactId: string): Promise<readonly SpeakerTask[]> {
      return listTasks(
        `SELECT ${TASK_COLUMNS} FROM speaker_tasks
          WHERE event_id = ? AND contact_id = ? ${TASK_ORDER}`,
        [eventId, contactId],
      )
    },

    async listBySubmission(eventId: string, submissionId: string): Promise<readonly SpeakerTask[]> {
      return listTasks(
        `SELECT ${TASK_COLUMNS} FROM speaker_tasks
          WHERE event_id = ? AND submission_id = ? ${TASK_ORDER}`,
        [eventId, submissionId],
      )
    },

    async findAcceptance(
      eventId: string,
      submissionId: string,
    ): Promise<SubmissionAcceptance | null> {
      const row = await db
        .prepare(
          `SELECT event_id, submission_id, accepted_at FROM submission_acceptances
            WHERE event_id = ? AND submission_id = ?`,
        )
        .bind(eventId, submissionId)
        .first<RawAcceptanceRow>()
      return row === null ? null : toAcceptance(row)
    },

    async listAcceptancesByEvent(eventId: string): Promise<readonly SubmissionAcceptance[]> {
      const result = await db
        .prepare(
          `SELECT event_id, submission_id, accepted_at FROM submission_acceptances
            WHERE event_id = ? ORDER BY submission_id`,
        )
        .bind(eventId)
        .all<RawAcceptanceRow>()
      return result.results.map(toAcceptance)
    },

    /**
     * Completion is a single conditional UPDATE: the `status = 'pending'` guard
     * keeps the first `completedAt` on a repeated call, and the event scope
     * means an id from another event can never be completed.
     */
    async markCompleted(
      eventId: string,
      id: string,
      completedAt: string,
    ): Promise<SpeakerTask | null> {
      await db
        .prepare(
          `UPDATE speaker_tasks SET status = 'completed', completed_at = ?
            WHERE event_id = ? AND id = ? AND status = 'pending'`,
        )
        .bind(completedAt, eventId, id)
        .run()
      const row = await db
        .prepare(`SELECT ${TASK_COLUMNS} FROM speaker_tasks WHERE event_id = ? AND id = ?`)
        .bind(eventId, id)
        .first<RawSpeakerTaskRow>()
      return row === null ? null : toSpeakerTask(row)
    },
  }
}
