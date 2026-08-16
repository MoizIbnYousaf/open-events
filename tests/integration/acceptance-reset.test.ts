import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import app from '../../src/server'
import { DEMO_CONF_2026_ID } from '../../src/db'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import { bindings } from './m2c-helpers'

const RESET_SECRET = 'acceptance-reset-secret-with-32-bytes'
const BUILD = 'revision-under-test'
const D1_ID = 'acceptance-d1-id'
const R2_NAME = 'open-events-acceptance-files'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

function resetBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    expectedEnvironment: 'acceptance',
    expectedBuildRevision: BUILD,
    expectedEventId: DEMO_CONF_2026_ID,
    expectedD1Id: D1_ID,
    expectedR2Bucket: R2_NAME,
    ...overrides,
  })
}

function acceptanceBindings(overrides: Record<string, unknown> = {}) {
  return bindings({
    DEPLOY_ENVIRONMENT: 'acceptance',
    BUILD_REVISION: BUILD,
    RESOURCE_D1_ID: D1_ID,
    RESOURCE_R2_NAME: R2_NAME,
    ACCEPTANCE_RESET_SECRET: RESET_SECRET,
    ...overrides,
  })
}

async function postReset(
  body = resetBody(),
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  return app.request(
    '/api/acceptance/reset',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RESET_SECRET}`,
        'content-type': 'application/json',
      },
      body,
    },
    acceptanceBindings(overrides),
  )
}

describe('acceptance event reset', () => {
  it('routes acceptance assets through the noindex guard', async () => {
    const response = await app.request(
      '/',
      undefined,
      acceptanceBindings({
        ASSETS: {
          fetch: () => Promise.resolve(new Response('<h1>Acceptance</h1>')),
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
    expect(await response.text()).toBe('<h1>Acceptance</h1>')

    const embed = await app.request(
      '/embed/not-found',
      undefined,
      acceptanceBindings({
        ASSETS: {
          fetch: () => Promise.resolve(new Response('wrong asset response')),
        },
      }),
    )
    expect(embed.status).toBe(404)
    expect(await embed.text()).not.toContain('wrong asset response')
  })

  it('routes production assets through the browser security guard', async () => {
    const response = await app.request(
      '/start',
      undefined,
      bindings({
        DEPLOY_ENVIRONMENT: 'production',
        ASSETS: {
          fetch: () => Promise.resolve(new Response('<h1>Start</h1>')),
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('x-robots-tag')).toBeNull()
    expect(await response.text()).toBe('<h1>Start</h1>')
  })

  it('deletes one event and its exact R2 prefix while preserving unrelated data', async () => {
    const otherEventId = 'b1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status)
       VALUES (?, 'other-event', 'Other event', 'UTC', 'draft')`,
    )
      .bind(otherEventId)
      .run()
    await env.DB.prepare(
      `INSERT INTO captured_messages
         (id, event_id, to_email, subject, body, created_at, recipient_fingerprint)
       VALUES ('reset-message', ?, 'r***@example.test', 'Protected', 'Protected',
               '2026-08-15T12:00:00.000Z', 'v1:reset')`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()
    await env.DB.prepare(
      `INSERT INTO email_delivery_jobs
         (id, captured_message_id, event_id, mode, status, recipient_fingerprint,
          key_version, nonce, ciphertext, payload_expires_at, attempts, created_at, updated_at)
       VALUES ('reset-job', 'reset-message', ?, 'capture', 'captured', 'v1:reset',
               'v1', 'nonce', 'ciphertext', '2026-08-16T12:00:00.000Z', 0,
               '2026-08-15T12:00:00.000Z', '2026-08-15T12:00:00.000Z')`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()
    await expect(
      env.DB.prepare(`DELETE FROM captured_messages WHERE id = 'reset-message'`).run(),
    ).rejects.toThrow('immutable')

    const targetOne = `events/${DEMO_CONF_2026_ID}/contacts/a/headshot/one`
    const targetTwo = `events/${DEMO_CONF_2026_ID}/contacts/b/document/two`
    const unrelated = `events/${otherEventId}/contacts/c/headshot/three`
    await Promise.all([
      env.FILES.put(targetOne, 'one'),
      env.FILES.put(targetTwo, 'two'),
      env.FILES.put(unrelated, 'three'),
    ])

    const response = await postReset()
    expect(response.status).toBe(200)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
    expect(await response.json()).toMatchObject({
      reset: true,
      eventId: DEMO_CONF_2026_ID,
      objectCount: 2,
    })
    expect(
      await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(DEMO_CONF_2026_ID).first(),
    ).toBeNull()
    expect(
      await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(otherEventId).first(),
    ).toEqual({
      id: otherEventId,
    })
    expect(await env.FILES.get(targetOne)).toBeNull()
    expect(await env.FILES.get(targetTwo)).toBeNull()
    expect(await env.FILES.get(unrelated)).not.toBeNull()
    expect(
      await env.DB.prepare(
        `SELECT event_id, environment, build_revision, d1_id, r2_bucket, object_count
         FROM acceptance_reset_audits`,
      ).first(),
    ).toEqual({
      event_id: DEMO_CONF_2026_ID,
      environment: 'acceptance',
      build_revision: BUILD,
      d1_id: D1_ID,
      r2_bucket: R2_NAME,
      object_count: 2,
    })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM acceptance_reset_authorizations').first(),
    ).toEqual({ count: 0 })

    expect((await postReset()).status).toBe(200)
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM acceptance_reset_audits').first(),
    ).toEqual({ count: 2 })
  })

  it('fails closed on secret or tuple mismatch before touching event data', async () => {
    expect((await postReset(resetBody({ expectedD1Id: 'production-id' }))).status).toBe(403)
    const wrongSecret = await app.request(
      '/api/acceptance/reset',
      {
        method: 'POST',
        headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
        body: resetBody(),
      },
      acceptanceBindings(),
    )
    expect(wrongSecret.status).toBe(403)
    expect(
      await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(DEMO_CONF_2026_ID).first(),
    ).not.toBeNull()
  })

  it('rejects an oversized body before touching event data', async () => {
    const oversized = JSON.stringify({
      ...JSON.parse(resetBody()),
      padding: 'x'.repeat(5 * 1024),
    })
    expect((await postReset(oversized)).status).toBe(400)
    expect(
      await env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(DEMO_CONF_2026_ID).first(),
    ).not.toBeNull()
  })

  it('is a production 404 even when the caller knows the acceptance credential', async () => {
    const response = await app.request(
      '/api/acceptance/reset',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${RESET_SECRET}`,
          'content-type': 'application/json',
        },
        body: resetBody(),
      },
      acceptanceBindings({ DEPLOY_ENVIRONMENT: 'production' }),
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })
})
