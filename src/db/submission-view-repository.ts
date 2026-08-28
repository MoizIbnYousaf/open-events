import type { D1Database } from '@cloudflare/workers-types'

import {
  SUBMISSION_VIEW_SCHEMA_VERSION,
  parseSubmissionViewState,
  type SubmissionViewRecord,
} from '../application/dtos/submission-view.dto'
import type { SubmissionViewRepository } from '../application/ports/submission-view-repository'
import { DbDecodeError } from './mappers'

interface RawViewRow {
  readonly event_id: string
  readonly id: string
  readonly name: string
  readonly schema_version: number
  readonly state_json: string
  readonly created_at: string
  readonly updated_at: string
}

function toView(row: RawViewRow): SubmissionViewRecord {
  if (row.schema_version !== SUBMISSION_VIEW_SCHEMA_VERSION) {
    throw new DbDecodeError(`saved submission view carries schema version '${row.schema_version}'`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(row.state_json) as unknown
  } catch {
    throw new DbDecodeError('saved submission view state_json is not valid JSON')
  }
  let state
  try {
    state = parseSubmissionViewState(parsed)
  } catch {
    throw new DbDecodeError('saved submission view state_json violates the view contract')
  }
  return {
    eventId: row.event_id,
    id: row.id,
    name: row.name,
    state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createSubmissionViewRepository(db: D1Database): SubmissionViewRepository {
  return {
    async listByEvent(eventId) {
      const result = await db
        .prepare(
          `SELECT event_id, id, name, schema_version, state_json, created_at, updated_at
             FROM submission_saved_views
            WHERE event_id = ?
            ORDER BY name COLLATE NOCASE ASC, id ASC`,
        )
        .bind(eventId)
        .all<RawViewRow>()
      return result.results.map(toView)
    },

    async create(view) {
      const result = await db
        .prepare(
          `INSERT INTO submission_saved_views
             (event_id, id, name, schema_version, state_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          view.eventId,
          view.id,
          view.name,
          view.state.schemaVersion,
          JSON.stringify(view.state),
          view.createdAt,
          view.updatedAt,
        )
        .run()
      return result.meta.changes === 1 ? 'created' : 'duplicate'
    },

    async delete(eventId, id) {
      const result = await db
        .prepare('DELETE FROM submission_saved_views WHERE event_id = ? AND id = ?')
        .bind(eventId, id)
        .run()
      return result.meta.changes === 1 ? 'deleted' : 'not-found'
    },
  }
}
