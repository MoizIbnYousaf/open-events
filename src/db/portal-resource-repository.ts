import type { D1Database } from '@cloudflare/workers-types'

import type { PortalResourceRepository } from '../application/ports/portal-resource-repository'
import type { PortalResource, PortalResourceKind } from '../domain'

interface RawPortalResource {
  readonly event_id: string
  readonly id: string
  readonly kind: PortalResourceKind
  readonly title: string
  readonly body: string | null
  readonly url: string | null
  readonly position: number
  readonly published: number
  readonly created_at: string
  readonly updated_at: string
}

function decode(row: RawPortalResource): PortalResource {
  return {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    url: row.url,
    position: row.position,
    published: row.published === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT = `SELECT event_id, id, kind, title, body, url, position, published,
                       created_at, updated_at
                  FROM portal_resources`

export function createPortalResourceRepository(db: D1Database): PortalResourceRepository {
  return {
    async listByEvent(eventId) {
      const result = await db
        .prepare(`${SELECT} WHERE event_id = ? ORDER BY position, id`)
        .bind(eventId)
        .all<RawPortalResource>()
      return result.results.map(decode)
    },
    async findById(eventId, id) {
      const row = await db
        .prepare(`${SELECT} WHERE event_id = ? AND id = ?`)
        .bind(eventId, id)
        .first<RawPortalResource>()
      return row === null ? null : decode(row)
    },
    async insert(resource) {
      await db
        .prepare(
          `INSERT INTO portal_resources
             (event_id, id, kind, title, body, url, position, published, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          resource.eventId,
          resource.id,
          resource.kind,
          resource.title,
          resource.body,
          resource.url,
          resource.position,
          resource.published ? 1 : 0,
          resource.createdAt,
          resource.updatedAt,
        )
        .run()
    },
    async update(resource) {
      const result = await db
        .prepare(
          `UPDATE portal_resources
              SET kind = ?, title = ?, body = ?, url = ?, position = ?, published = ?, updated_at = ?
            WHERE event_id = ? AND id = ?`,
        )
        .bind(
          resource.kind,
          resource.title,
          resource.body,
          resource.url,
          resource.position,
          resource.published ? 1 : 0,
          resource.updatedAt,
          resource.eventId,
          resource.id,
        )
        .run()
      return result.meta.changes === 1 ? 'updated' : 'not-found'
    },
    async delete(eventId, id) {
      const result = await db
        .prepare('DELETE FROM portal_resources WHERE event_id = ? AND id = ?')
        .bind(eventId, id)
        .run()
      return result.meta.changes === 1 ? 'deleted' : 'not-found'
    },
    async reorder(eventId, ids, updatedAt) {
      const existing = await db
        .prepare('SELECT id FROM portal_resources WHERE event_id = ? ORDER BY id')
        .bind(eventId)
        .all<{ id: string }>()
      const expected = existing.results.map((row) => row.id).sort()
      const supplied = [...ids].sort()
      if (new Set(ids).size !== ids.length || expected.join('\0') !== supplied.join('\0')) {
        return false
      }
      await db.batch(
        ids.map((id, position) =>
          db
            .prepare(
              'UPDATE portal_resources SET position = ?, updated_at = ? WHERE event_id = ? AND id = ?',
            )
            .bind(position, updatedAt, eventId, id),
        ),
      )
      return true
    },
  }
}
