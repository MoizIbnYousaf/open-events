import type { D1Database } from '@cloudflare/workers-types'
import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import migrationSql from '../../migrations/0001_create_events_table.sql?raw'
import type { EventDto } from '../../src/application'
import type { EventStatus } from '../../src/domain'
import type { HealthPayload } from '../../src/server/health'
import app from '../../src/server'

/** Real schema from `migrations/`, applied to the pool DB without the seed. */
const migrations: D1Migration[] = [
  {
    name: '0001_create_events_table.sql',
    queries: [
      migrationSql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    ],
  },
]

/** Row shape returned by a real D1 query for the `events` table. */
interface FakeD1ResultRow {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly timezone: string
  readonly status: EventStatus
  readonly starts_at: string | null
  readonly ends_at: string | null
}

/** `D1PreparedStatement.raw()` row: values in Drizzle `events` column order. */
type FakeD1RawRow = [
  id: string,
  slug: string,
  name: string,
  timezone: string,
  status: string,
  starts_at: string | null,
  ends_at: string | null,
]

interface FakeD1Statement {
  bind(..._params: unknown[]): FakeD1Statement
  all(): Promise<{ results: readonly FakeD1ResultRow[] }>
  raw(): Promise<readonly FakeD1RawRow[]>
  run(): Promise<{ success: true }>
  first(): Promise<FakeD1ResultRow | null>
}

function toRawRow(row: FakeD1ResultRow): FakeD1RawRow {
  return [row.id, row.slug, row.name, row.timezone, row.status, row.starts_at, row.ends_at]
}

/**
 * Minimal in-memory `D1Database` covering the calls the real adapter makes:
 * the health probe (`prepare(...).run()`) and the Drizzle D1 driver
 * (`prepare(...).bind(...).raw()` for selects with fields).
 */
function createFakeD1Database(rows: readonly FakeD1ResultRow[]): D1Database {
  const statement: FakeD1Statement = {
    bind() {
      return statement
    },
    async all() {
      return { results: rows }
    },
    async raw() {
      return rows.map(toRawRow)
    },
    async run() {
      return { success: true }
    },
    async first() {
      return rows[0] ?? null
    },
  }

  return { prepare: () => statement } as unknown as D1Database
}

const seededRow: FakeD1ResultRow = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: 'demo-conf-2026',
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  starts_at: '2026-05-13T08:00:00.000Z',
  ends_at: '2026-05-15T17:00:00.000Z',
}

const expectedEventDto: EventDto = {
  id: seededRow.id,
  slug: seededRow.slug,
  name: seededRow.name,
  timezone: seededRow.timezone,
  status: seededRow.status,
  startsAt: seededRow.starts_at,
  endsAt: seededRow.ends_at,
  logoUrl: null,
  logoWidth: null,
  logoHeight: null,
  logoUpdatedAt: null,
  backgroundUrl: null,
  backgroundWidth: null,
  backgroundHeight: null,
  backgroundUpdatedAt: null,
}

const emailCaptureBindings = {
  EMAIL_DELIVERY_MODE: 'capture',
  EMAIL_PAYLOAD_KEY_VERSION: 'v1',
  EMAIL_PAYLOAD_KEY_V1: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  RATE_LIMIT_ENVIRONMENT: 'test',
}

describe('Workers-pool integration: real Hono app against the pool D1 binding', () => {
  it('GET /api/health returns 200 with database.status ok', async () => {
    const response = await app.request('/api/health', undefined, {
      ...env,
      DEPLOY_ENVIRONMENT: 'test',
      BUILD_REVISION: 'test-revision',
      RESOURCE_D1_ID: 'test-d1',
      RESOURCE_R2_NAME: 'test-r2',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = (await response.json()) as HealthPayload
    expect(payload).toEqual({
      status: 'ok',
      build: 'test-revision',
      environment: 'test',
      resources: { d1: 'test-d1', r2: 'test-r2' },
      database: { status: 'ok' },
    })
  })

  it('GET /api/events/demo-conf-2026 returns 404 on the pool empty database', async () => {
    await applyD1Migrations(env.DB, migrations)

    const response = await app.request('/api/events/demo-conf-2026', undefined, {
      ...env,
      ...emailCaptureBindings,
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('GET /api/events/:slug returns the seeded row through route -> service -> repository', async () => {
    const response = await app.request('/api/events/demo-conf-2026', undefined, {
      DB: createFakeD1Database([seededRow]),
      PUBLIC_APP_URL: 'https://www.openevents.engineer',
      SUBMITTER_CAPABILITY_WRITER_MODE: 'purpose',
      SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'bounded',
      ...emailCaptureBindings,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expectedEventDto)
  })
})
