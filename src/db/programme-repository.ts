import type { D1Database } from '@cloudflare/workers-types'

import type { ProgrammeRepository } from '../application/ports/programme-repository'
import type { EmbedRecord, SessionContentStatus, SpeakerWorkflowStatus } from '../domain/embed'
import type { AssignmentKind, EmbedFormat, EmbedKind } from '../domain/embed'

interface EmbedRow {
  readonly id: string
  readonly event_id: string
  readonly name: string
  readonly kind: EmbedKind
  readonly format: EmbedFormat
  readonly enabled: number
  readonly brand_color: string
  readonly track_filter: string
  readonly created_at: string
  readonly updated_at: string
}

function toEmbed(row: EmbedRow): EmbedRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    kind: row.kind,
    format: row.format,
    enabled: row.enabled === 1,
    brandColor: row.brand_color,
    trackFilter: row.track_filter,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createProgrammeRepository(db: D1Database): ProgrammeRepository {
  return {
    async listEmbeds(eventId) {
      const result = await db
        .prepare(
          `SELECT id, event_id, name, kind, format, enabled, brand_color, track_filter,
                  created_at, updated_at
             FROM embeds WHERE event_id = ? ORDER BY created_at DESC, id`,
        )
        .bind(eventId)
        .all<EmbedRow>()
      return result.results.map(toEmbed)
    },
    async findEmbed(id) {
      const row = await db
        .prepare(
          `SELECT id, event_id, name, kind, format, enabled, brand_color, track_filter,
                  created_at, updated_at
             FROM embeds WHERE id = ?`,
        )
        .bind(id)
        .first<EmbedRow>()
      return row === null ? null : toEmbed(row)
    },
    async saveEmbed(record) {
      await db
        .prepare(
          `INSERT INTO embeds
             (id, event_id, name, kind, format, enabled, brand_color, track_filter, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             kind = excluded.kind,
             format = excluded.format,
             enabled = excluded.enabled,
             brand_color = excluded.brand_color,
             track_filter = excluded.track_filter,
             updated_at = excluded.updated_at`,
        )
        .bind(
          record.id,
          record.eventId,
          record.name,
          record.kind,
          record.format,
          record.enabled ? 1 : 0,
          record.brandColor,
          record.trackFilter,
          record.createdAt,
          record.updatedAt,
        )
        .run()
    },

    async listRevisions(eventId, submissionId) {
      const result = await db
        .prepare(
          `SELECT id, event_id, submission_id, editor_name, title, abstract, created_at
             FROM content_revisions
            WHERE event_id = ? AND submission_id = ?
            ORDER BY created_at ASC, id`,
        )
        .bind(eventId, submissionId)
        .all<{
          id: string
          event_id: string
          submission_id: string
          editor_name: string
          title: string
          abstract: string
          created_at: string
        }>()
      return result.results.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        submissionId: row.submission_id,
        editorName: row.editor_name,
        title: row.title,
        abstract: row.abstract,
        createdAt: row.created_at,
      }))
    },
    async addRevision(record) {
      await db
        .prepare(
          `INSERT INTO content_revisions
             (id, event_id, submission_id, editor_name, title, abstract, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.id,
          record.eventId,
          record.submissionId,
          record.editorName,
          record.title,
          record.abstract,
          record.createdAt,
        )
        .run()
    },
    async findRevision(id) {
      const row = await db
        .prepare(
          `SELECT id, event_id, submission_id, editor_name, title, abstract, created_at
             FROM content_revisions WHERE id = ?`,
        )
        .bind(id)
        .first<{
          id: string
          event_id: string
          submission_id: string
          editor_name: string
          title: string
          abstract: string
          created_at: string
        }>()
      return row === null
        ? null
        : {
            id: row.id,
            eventId: row.event_id,
            submissionId: row.submission_id,
            editorName: row.editor_name,
            title: row.title,
            abstract: row.abstract,
            createdAt: row.created_at,
          }
    },

    async getContentStatus(eventId, submissionId) {
      const row = await db
        .prepare(
          `SELECT status FROM session_content_status
            WHERE event_id = ? AND submission_id = ?`,
        )
        .bind(eventId, submissionId)
        .first<{ status: SessionContentStatus }>()
      return row?.status ?? 'approved'
    },
    async setContentStatus(eventId, submissionId, status) {
      await db
        .prepare(
          `INSERT INTO session_content_status (event_id, submission_id, status)
           VALUES (?, ?, ?)
           ON CONFLICT(event_id, submission_id) DO UPDATE SET status = excluded.status`,
        )
        .bind(eventId, submissionId, status)
        .run()
    },
    async listContentStatuses(eventId) {
      const result = await db
        .prepare(`SELECT submission_id, status FROM session_content_status WHERE event_id = ?`)
        .bind(eventId)
        .all<{ submission_id: string; status: SessionContentStatus }>()
      return result.results.map((row) => ({
        submissionId: row.submission_id,
        status: row.status,
      }))
    },

    async saveAssignment(record) {
      await db
        .prepare(
          `INSERT INTO speaker_assignments
             (id, event_id, title, due_at, kind, instructions, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.id,
          record.eventId,
          record.title,
          record.dueAt,
          record.kind,
          record.instructions,
          record.createdAt,
        )
        .run()
    },
    async listAssignments(eventId) {
      const result = await db
        .prepare(
          `SELECT id, event_id, title, due_at, kind, instructions, created_at
             FROM speaker_assignments WHERE event_id = ? ORDER BY created_at, id`,
        )
        .bind(eventId)
        .all<{
          id: string
          event_id: string
          title: string
          due_at: string | null
          kind: AssignmentKind
          instructions: string
          created_at: string
        }>()
      return result.results.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        title: row.title,
        dueAt: row.due_at,
        kind: row.kind,
        instructions: row.instructions,
        createdAt: row.created_at,
      }))
    },
    async findAssignment(id) {
      const row = await db
        .prepare(
          `SELECT id, event_id, title, due_at, kind, instructions, created_at
             FROM speaker_assignments WHERE id = ?`,
        )
        .bind(id)
        .first<{
          id: string
          event_id: string
          title: string
          due_at: string | null
          kind: AssignmentKind
          instructions: string
          created_at: string
        }>()
      return row === null
        ? null
        : {
            id: row.id,
            eventId: row.event_id,
            title: row.title,
            dueAt: row.due_at,
            kind: row.kind,
            instructions: row.instructions,
            createdAt: row.created_at,
          }
    },
    async setAssignees(assignmentId, assignees) {
      const statements = [
        db
          .prepare('DELETE FROM speaker_assignment_assignees WHERE assignment_id = ?')
          .bind(assignmentId),
      ]
      for (const assignee of assignees) {
        statements.push(
          db
            .prepare(
              `INSERT INTO speaker_assignment_assignees
                 (assignment_id, contact_id, status, completed_at)
               VALUES (?, ?, ?, ?)`,
            )
            .bind(assignmentId, assignee.contactId, assignee.status, assignee.completedAt),
        )
      }
      await db.batch(statements)
    },
    async listAssignees(assignmentId) {
      const result = await db
        .prepare(
          `SELECT assignment_id, contact_id, status, completed_at
             FROM speaker_assignment_assignees WHERE assignment_id = ?`,
        )
        .bind(assignmentId)
        .all<{
          assignment_id: string
          contact_id: string
          status: 'pending' | 'completed'
          completed_at: string | null
        }>()
      return result.results.map((row) => ({
        assignmentId: row.assignment_id,
        contactId: row.contact_id,
        status: row.status,
        completedAt: row.completed_at,
      }))
    },
    async listAssigneesForContact(eventId, contactId) {
      const result = await db
        .prepare(
          `SELECT a.id, a.event_id, a.title, a.due_at, a.kind, a.instructions, a.created_at,
                  x.status, x.completed_at
             FROM speaker_assignment_assignees x
             JOIN speaker_assignments a ON a.id = x.assignment_id
            WHERE a.event_id = ? AND x.contact_id = ?
            ORDER BY a.created_at, a.id`,
        )
        .bind(eventId, contactId)
        .all<{
          id: string
          event_id: string
          title: string
          due_at: string | null
          kind: AssignmentKind
          instructions: string
          created_at: string
          status: 'pending' | 'completed'
          completed_at: string | null
        }>()
      return result.results.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        title: row.title,
        dueAt: row.due_at,
        kind: row.kind,
        instructions: row.instructions,
        createdAt: row.created_at,
        status: row.status,
        completedAt: row.completed_at,
      }))
    },
    async completeAssignee(assignmentId, contactId, completedAt) {
      const result = await db
        .prepare(
          `UPDATE speaker_assignment_assignees
              SET status = 'completed', completed_at = ?
            WHERE assignment_id = ? AND contact_id = ?`,
        )
        .bind(completedAt, assignmentId, contactId)
        .run()
      return (result.meta.changes ?? 0) > 0 ? 'updated' : 'not-found'
    },

    async findSpeakerProfile(eventId, contactId) {
      const row = await db
        .prepare(
          `SELECT job_title, company, workflow_status
             FROM speaker_profiles WHERE event_id = ? AND contact_id = ?`,
        )
        .bind(eventId, contactId)
        .first<{ job_title: string; company: string; workflow_status: SpeakerWorkflowStatus }>()
      return row === null
        ? null
        : {
            jobTitle: row.job_title,
            company: row.company,
            workflowStatus: row.workflow_status,
          }
    },
  }
}
