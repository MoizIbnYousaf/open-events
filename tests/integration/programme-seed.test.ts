import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import {
  applyMigrations,
  seedDemoConf,
  seedDemoConfProgramme,
  SEEDED_PROGRAMME_SESSIONS,
} from './m2b-helpers'
import { bindings } from './m2c-helpers'
import app from '../../src/server'

/**
 * The demo programme is opt-in, and this is the tripwire that keeps it that way.
 *
 * Every public surface renders nothing without published sessions, so there is
 * a standing temptation to seed them by default. Doing that would silently
 * inflate the absolute row totals the golden journeys assert, and would be
 * discovered as a puzzling end-to-end failure rather than here.
 */
describe('the demo programme seed', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
  })

  async function publicSessionCount(): Promise<number> {
    const response = await app.request(
      '/api/public/events/demo-conf-2026/schedule',
      undefined,
      bindings(),
    )
    expect(response.status).toBe(200)
    return ((await response.json()) as { sessions: readonly unknown[] }).sessions.length
  }

  it('leaves the base seed with no programme at all', async () => {
    const sessions = await env.DB.prepare('SELECT COUNT(*) AS n FROM agenda_sessions').first<{
      n: number
    }>()

    expect(sessions?.n).toBe(0)
    expect(await publicSessionCount()).toBe(0)
  })

  it('publishes a real programme when it is asked for', async () => {
    await seedDemoConfProgramme(env.DB)

    expect(await publicSessionCount()).toBe(SEEDED_PROGRAMME_SESSIONS)
  })

  it('spans two days, both rooms and three tracks', async () => {
    await seedDemoConfProgramme(env.DB)

    const spread = await env.DB.prepare(
      `SELECT COUNT(DISTINCT day) AS days, COUNT(DISTINCT room_id) AS rooms,
              COUNT(DISTINCT track_id) AS tracks FROM agenda_sessions`,
    ).first<{ days: number; rooms: number; tracks: number }>()

    // A programme on one day in one room exercises no day navigation and no
    // track facet, which is most of what the public surfaces are for.
    expect(spread?.days).toBe(2)
    expect(spread?.rooms).toBe(2)
    expect(spread?.tracks).toBe(3)
  })

  it('is idempotent, so re-running it is a no-op rather than an error', async () => {
    await seedDemoConfProgramme(env.DB)
    await seedDemoConfProgramme(env.DB)

    expect(await publicSessionCount()).toBe(SEEDED_PROGRAMME_SESSIONS)
  })

  it('gives at least one session more than one speaker', async () => {
    await seedDemoConfProgramme(env.DB)

    const shared = await env.DB.prepare(
      `SELECT submission_id, COUNT(*) AS n FROM agenda_session_speakers
        GROUP BY submission_id HAVING n > 1`,
    ).all<{ submission_id: string; n: number }>()

    // A programme where every session has exactly one name never exercises the
    // plural case any speaker list has to handle.
    expect(shared.results.length).toBeGreaterThanOrEqual(1)
  })
})
