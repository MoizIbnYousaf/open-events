import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import app from '../../src/server'
import type { SubmissionViewRecord } from '../../src/application/ports/submission-view-repository'
import { createSubmissionViewRepository } from '../../src/db/submission-view-repository'
import { DEMO_CONF_2026_ID } from '../../src/db/seed'
import { MIGRATIONS, applyMigrations, migrationsUpTo, seedDemoConf } from './m2b-helpers'
import { ALLOWED_ORIGIN, bindings, cookieHeader, loginOrganizer } from './m2c-helpers'

const NOW = '2026-08-28T12:00:00.000Z'
const STATE = {
  schemaVersion: 1 as const,
  decision: 'pending' as const,
  routing: 'all',
  sort: 'title-asc' as const,
  facets: [{ elementId: 'f0000000-0000-4000-8000-000000000201', values: ['Talk'] }],
}

function view(overrides: Partial<SubmissionViewRecord> = {}): SubmissionViewRecord {
  return {
    eventId: DEMO_CONF_2026_ID,
    id: 'view-1',
    name: 'Needs review',
    state: STATE,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

describe('submission saved view repository', () => {
  it('creates, lists, and deletes event-scoped view state', async () => {
    const repository = createSubmissionViewRepository(env.DB)
    expect(await repository.create(view())).toBe('created')
    expect(await repository.listByEvent(DEMO_CONF_2026_ID)).toEqual([view()])
    expect(await repository.delete(DEMO_CONF_2026_ID, 'view-1')).toBe('deleted')
    expect(await repository.listByEvent(DEMO_CONF_2026_ID)).toEqual([])
  })

  it('enforces case-insensitive unique names without overwriting the first view', async () => {
    const repository = createSubmissionViewRepository(env.DB)
    expect(await repository.create(view())).toBe('created')
    expect(
      await repository.create(
        view({ id: 'view-2', name: 'needs REVIEW', state: { ...STATE, routing: 'ai' } }),
      ),
    ).toBe('duplicate')
    expect(await repository.listByEvent(DEMO_CONF_2026_ID)).toEqual([view()])
  })

  it('uses event scope in delete predicates and rejects malformed stored state', async () => {
    const repository = createSubmissionViewRepository(env.DB)
    expect(await repository.create(view())).toBe('created')
    expect(await repository.delete('event-other', 'view-1')).toBe('not-found')
    expect(await repository.listByEvent(DEMO_CONF_2026_ID)).toEqual([view()])

    await expect(
      env.DB.prepare(
        `INSERT INTO submission_saved_views
           (event_id, id, name, schema_version, state_json, created_at, updated_at)
         VALUES (?, 'view-bad', 'Bad', 1, '[]', ?, ?)`,
      )
        .bind(DEMO_CONF_2026_ID, NOW, NOW)
        .run(),
    ).rejects.toThrow()

    await expect(
      env.DB.prepare(
        `INSERT INTO submission_saved_views
           (event_id, id, name, schema_version, state_json, created_at, updated_at)
         VALUES (?, 'view-missing-schema', 'Missing schema', 1, '{"decision":"all"}', ?, ?)`,
      )
        .bind(DEMO_CONF_2026_ID, NOW, NOW)
        .run(),
    ).rejects.toThrow()
  })

  it('reads an early schema-v1 row without returning its private query text', async () => {
    await env.DB.prepare(
      `INSERT INTO submission_saved_views
         (event_id, id, name, schema_version, state_json, created_at, updated_at)
       VALUES (?, 'view-legacy-query', 'Legacy query', 1, ?, ?, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, JSON.stringify({ ...STATE, q: 'speaker@example.test' }), NOW, NOW)
      .run()

    expect(await createSubmissionViewRepository(env.DB).listByEvent(DEMO_CONF_2026_ID)).toEqual([
      view({ id: 'view-legacy-query', name: 'Legacy query' }),
    ])
  })

  it('removes private query text when upgrading an early schema-v1 database', async () => {
    await reset()
    await applyD1Migrations(env.DB, migrationsUpTo('0036_programme_timeline_indexes.sql'))
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status)
       VALUES ('event-legacy-view', 'legacy-view', 'Legacy view', 'UTC', 'draft')`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO submission_saved_views
         (event_id, id, name, schema_version, state_json, created_at, updated_at)
       VALUES ('event-legacy-view', 'view-legacy', 'Legacy', 1, ?, ?, ?)`,
    )
      .bind(JSON.stringify({ ...STATE, q: 'speaker@example.test' }), NOW, NOW)
      .run()

    await applyD1Migrations(env.DB, MIGRATIONS.slice(-1))

    const stored = await env.DB.prepare(
      `SELECT json_type(state_json, '$.q') AS query_type
         FROM submission_saved_views WHERE id = 'view-legacy'`,
    ).first<{ query_type: string | null }>()
    expect(stored?.query_type).toBeNull()
  })
})

describe('submission saved view API', () => {
  async function request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    origin = ALLOWED_ORIGIN,
  ) {
    const token = (await loginOrganizer()).token ?? ''
    return app.request(
      path,
      {
        method,
        headers: {
          cookie: cookieHeader(token),
          ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      bindings(),
    )
  }

  it('creates, lists, and deletes shared event views', async () => {
    const created = await request('POST', '/api/admin/events/demo-conf-2026/submission-views', {
      name: 'Needs review',
      state: STATE,
    })
    expect(created.status).toBe(201)
    const view = (await created.json()) as { id: string }

    const listed = await request('GET', '/api/admin/events/demo-conf-2026/submission-views')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: view.id, name: 'Needs review', state: STATE }),
    ])

    const removed = await request(
      'DELETE',
      `/api/admin/events/demo-conf-2026/submission-views/${view.id}`,
      {},
    )
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ deleted: true })
    expect(
      await (await request('GET', '/api/admin/events/demo-conf-2026/submission-views')).json(),
    ).toEqual([])
  })

  it('rejects duplicates, malformed state, missing CSRF proof, and cross-event ids', async () => {
    expect(
      (
        await request('POST', '/api/admin/events/demo-conf-2026/submission-views', {
          name: 'Needs review',
          state: STATE,
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await request('POST', '/api/admin/events/demo-conf-2026/submission-views', {
          name: 'needs REVIEW',
          state: STATE,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request('POST', '/api/admin/events/demo-conf-2026/submission-views', {
          name: 'Broken',
          state: { ...STATE, decision: 'maybe' },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request('POST', '/api/admin/events/demo-conf-2026/submission-views', {
          name: 'Private search',
          state: { ...STATE, q: 'speaker@example.test' },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request(
          'POST',
          '/api/admin/events/demo-conf-2026/submission-views',
          { name: 'No origin', state: STATE },
          '',
        )
      ).status,
    ).toBe(403)

    const otherEventId = 'event-view-other'
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status)
       VALUES (?, 'view-other', 'View other', 'UTC', 'draft')`,
    )
      .bind(otherEventId)
      .run()
    await createSubmissionViewRepository(env.DB).create(
      view({ eventId: otherEventId, id: 'view-other', name: 'Other view' }),
    )
    expect(
      (await request('DELETE', '/api/admin/events/demo-conf-2026/submission-views/view-other', {}))
        .status,
    ).toBe(404)
  })
})
