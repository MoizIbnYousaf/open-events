import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import type { AgendaRepository, AgendaSessionRecord } from '../application'
import type { AgendaSessionAssignment, AgendaSessionStatus } from '../domain/agenda'

/**
 * The port and its record shape, re-exported beside the adapter that fulfils
 * them: `AgendaSessionRecord` is the camelCase mirror of `agenda_sessions`.
 */
export type { AgendaRepository, AgendaSessionRecord }

interface RawAgendaSessionRow {
  readonly event_id: string
  readonly submission_id: string
  readonly track_id: string | null
  readonly room_id: string | null
  readonly day: string
  readonly start: string
  readonly end: string
  readonly position: number | null
  readonly status: AgendaSessionStatus
  readonly assignment: AgendaSessionAssignment
  readonly created_at: string
  readonly updated_at: string
}

interface RawAgendaSpeakerRow {
  readonly submission_id: string
  readonly contact_id: string
}

function mapSessionRow(
  row: RawAgendaSessionRow,
  speakerIds: readonly string[],
): AgendaSessionRecord {
  return {
    eventId: row.event_id,
    submissionId: row.submission_id,
    trackId: row.track_id,
    roomId: row.room_id,
    day: row.day,
    start: row.start,
    end: row.end,
    position: row.position,
    status: row.status,
    assignment: row.assignment,
    speakerIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SESSION_COLUMNS = `event_id, submission_id, track_id, room_id, day, start, end,
                position, status, assignment, created_at, updated_at`

/** D1 adapter for the `AgendaRepository` port. */
export function createAgendaRepository(db: D1Database): AgendaRepository {
  const listByEvent = async (eventId: string): Promise<readonly AgendaSessionRecord[]> => {
    const sessionResult = await db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM agenda_sessions WHERE event_id = ? ORDER BY day, start, position, room_id, submission_id`,
      )
      .bind(eventId)
      .all<RawAgendaSessionRow>()
    const rows = sessionResult.results ?? []
    const speakersBySubmission = new Map<string, string[]>()
    const speakerResult = await db
      .prepare(`SELECT submission_id, contact_id FROM agenda_session_speakers WHERE event_id = ?`)
      .bind(eventId)
      .all<RawAgendaSpeakerRow>()
    for (const speaker of speakerResult.results ?? []) {
      const bucket = speakersBySubmission.get(speaker.submission_id)
      if (bucket === undefined) {
        speakersBySubmission.set(speaker.submission_id, [speaker.contact_id])
      } else {
        bucket.push(speaker.contact_id)
      }
    }
    return rows.map((row) => mapSessionRow(row, speakersBySubmission.get(row.submission_id) ?? []))
  }

  const findBySubmission = async (
    eventId: string,
    submissionId: string,
  ): Promise<AgendaSessionRecord | null> => {
    const sessionRow = await db
      .prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM agenda_sessions WHERE event_id = ? AND submission_id = ?`,
      )
      .bind(eventId, submissionId)
      .first<RawAgendaSessionRow>()
    if (sessionRow === null) return null
    const speakerResult = await db
      .prepare(
        `SELECT contact_id FROM agenda_session_speakers WHERE event_id = ? AND submission_id = ?`,
      )
      .bind(eventId, submissionId)
      .all<{ readonly contact_id: string }>()
    const speakerIds = (speakerResult.results ?? []).map((speaker) => speaker.contact_id)
    return mapSessionRow(sessionRow, speakerIds)
  }

  const saveSession = async (session: AgendaSessionRecord): Promise<void> => {
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO agenda_sessions
             (event_id, submission_id, track_id, room_id, day, start, end,
              position, status, assignment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id, submission_id) DO UPDATE SET
             track_id = excluded.track_id,
             room_id = excluded.room_id,
             day = excluded.day,
             start = excluded.start,
             end = excluded.end,
             position = excluded.position,
             status = excluded.status,
             assignment = excluded.assignment,
             updated_at = excluded.updated_at`,
        )
        .bind(
          session.eventId,
          session.submissionId,
          session.trackId,
          session.roomId,
          session.day,
          session.start,
          session.end,
          session.position,
          session.status,
          session.assignment,
          session.createdAt,
          session.updatedAt,
        ),
      db
        .prepare(`DELETE FROM agenda_session_speakers WHERE event_id = ? AND submission_id = ?`)
        .bind(session.eventId, session.submissionId),
      ...session.speakerIds.map((contactId) =>
        db
          .prepare(
            `INSERT INTO agenda_session_speakers (event_id, submission_id, contact_id)
             VALUES (?, ?, ?)`,
          )
          .bind(session.eventId, session.submissionId, contactId),
      ),
    ]
    await db.batch(statements)
  }

  return { listByEvent, findBySubmission, saveSession }
}
