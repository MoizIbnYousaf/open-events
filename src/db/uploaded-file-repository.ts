import type { D1Database } from '@cloudflare/workers-types'

import type {
  UploadedFileKind,
  UploadedFileRecord,
  UploadedFileRepository,
} from '../application/ports/uploaded-file-repository'

interface RawUploadedFileRow {
  readonly id: string
  readonly event_id: string
  readonly owner_contact_id: string
  readonly kind: UploadedFileKind
  readonly storage_key: string
  readonly content_type: string
  readonly size_bytes: number
  readonly created_at: string
  readonly updated_at: string
  readonly file_name: string | null
}

function mapRow(row: RawUploadedFileRow): UploadedFileRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    ownerContactId: row.owner_contact_id,
    kind: row.kind,
    storageKey: row.storage_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileName: row.file_name,
  }
}

const SELECT_OWN = `SELECT id, event_id, owner_contact_id, kind, storage_key, content_type,
                           size_bytes, created_at, updated_at, file_name
                    FROM uploaded_files
                    WHERE event_id = ? AND owner_contact_id = ? AND kind = ?`

/**
 * D1 adapter for `uploaded_files`. The upsert replaces the single current row
 * for (event, owner, kind) in one batched transaction and returns the row it
 * replaced so the caller can retire the superseded object.
 */
export function createUploadedFileRepository(db: D1Database): UploadedFileRepository {
  return {
    async findOwn(eventId, ownerContactId, kind) {
      const row = await db
        .prepare(SELECT_OWN)
        .bind(eventId, ownerContactId, kind)
        .first<RawUploadedFileRow>()
      return row === null ? null : mapRow(row)
    },
    async upsert(record) {
      const previous = await db
        .prepare(SELECT_OWN)
        .bind(record.eventId, record.ownerContactId, record.kind)
        .first<RawUploadedFileRow>()
      await db.batch([
        db
          .prepare(
            'DELETE FROM uploaded_files WHERE event_id = ? AND owner_contact_id = ? AND kind = ?',
          )
          .bind(record.eventId, record.ownerContactId, record.kind),
        db
          .prepare(
            `INSERT INTO uploaded_files
               (id, event_id, owner_contact_id, kind, storage_key, content_type,
                size_bytes, created_at, updated_at, file_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            record.id,
            record.eventId,
            record.ownerContactId,
            record.kind,
            record.storageKey,
            record.contentType,
            record.sizeBytes,
            record.createdAt,
            record.updatedAt,
            record.fileName ?? null,
          ),
      ])
      return previous === null ? null : mapRow(previous)
    },
    async listByEvent(eventId) {
      const result = await db
        .prepare(
          `${SELECT_OWN.replace(
            'WHERE event_id = ? AND owner_contact_id = ? AND kind = ?',
            'WHERE event_id = ?',
          )} ORDER BY updated_at DESC, id`,
        )
        .bind(eventId)
        .all<RawUploadedFileRow>()
      return result.results.map(mapRow)
    },
    async listVersions(eventId, ownerContactId, kind) {
      const result = await db
        .prepare(
          `SELECT id, event_id, owner_contact_id, kind, version, storage_key, content_type,
                  size_bytes, file_name, created_at
             FROM uploaded_file_versions
            WHERE event_id = ? AND owner_contact_id = ? AND kind = ?
            ORDER BY version ASC`,
        )
        .bind(eventId, ownerContactId, kind)
        .all<{
          id: string
          event_id: string
          owner_contact_id: string
          kind: UploadedFileKind
          version: number
          storage_key: string
          content_type: string
          size_bytes: number
          file_name: string | null
          created_at: string
        }>()
      return result.results.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        ownerContactId: row.owner_contact_id,
        kind: row.kind,
        version: row.version,
        storageKey: row.storage_key,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
        fileName: row.file_name,
        createdAt: row.created_at,
      }))
    },
    async recordVersion(record) {
      await db
        .prepare(
          `INSERT INTO uploaded_file_versions
             (id, event_id, owner_contact_id, kind, version, storage_key, content_type,
              size_bytes, file_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.id,
          record.eventId,
          record.ownerContactId,
          record.kind,
          record.version,
          record.storageKey,
          record.contentType,
          record.sizeBytes,
          record.fileName,
          record.createdAt,
        )
        .run()
    },
    async listComments(eventId, ownerContactId, kind) {
      const result = await db
        .prepare(
          `SELECT id, event_id, owner_contact_id, kind, author_name, body, created_at
             FROM uploaded_file_comments
            WHERE event_id = ? AND owner_contact_id = ? AND kind = ?
            ORDER BY created_at ASC, id`,
        )
        .bind(eventId, ownerContactId, kind)
        .all<{
          id: string
          event_id: string
          owner_contact_id: string
          kind: UploadedFileKind
          author_name: string
          body: string
          created_at: string
        }>()
      return result.results.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        ownerContactId: row.owner_contact_id,
        kind: row.kind,
        authorName: row.author_name,
        body: row.body,
        createdAt: row.created_at,
      }))
    },
    async addComment(record) {
      await db
        .prepare(
          `INSERT INTO uploaded_file_comments
             (id, event_id, owner_contact_id, kind, author_name, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.id,
          record.eventId,
          record.ownerContactId,
          record.kind,
          record.authorName,
          record.body,
          record.createdAt,
        )
        .run()
    },
  }
}
