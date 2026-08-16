import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import app from '../../src/server'
import { DEMO_CONF_2026_ID } from '../../src/db'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import { bindings } from './m2c-helpers'

const SECRET_MATERIAL = 'webhook-test-secret-material'
const WEBHOOK_SECRET = `whsec_${btoa(SECRET_MATERIAL)}`

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function seedJob(options: {
  id: string
  providerId?: string | null
  ciphertext?: string | null
}): Promise<void> {
  const messageId = `message-${options.id}`
  const now = '2026-08-15T12:00:00.000Z'
  await env.DB.prepare(
    `INSERT INTO captured_messages
       (id, event_id, to_email, subject, body, created_at, recipient_fingerprint)
     VALUES (?, ?, 'p***@example.test', 'Protected subject', 'Protected audit body', ?, ?)`,
  )
    .bind(messageId, DEMO_CONF_2026_ID, now, `v1:fingerprint-${options.id}`)
    .run()
  await env.DB.prepare(
    `INSERT INTO email_delivery_jobs
       (id, captured_message_id, event_id, mode, status, recipient_fingerprint,
        key_version, nonce, ciphertext, payload_expires_at, attempts, next_attempt_at,
        provider_id, provider_status, provider_status_at, created_at, updated_at)
     VALUES (?, ?, ?, 'resend-test', 'retry', ?, 'v1', 'nonce', ?,
             '2026-08-16T12:00:00.000Z', 1, ?, ?,
             CASE WHEN ? IS NULL THEN NULL ELSE 'accepted' END,
             CASE WHEN ? IS NULL THEN NULL ELSE ? END, ?, ?)`,
  )
    .bind(
      options.id,
      messageId,
      DEMO_CONF_2026_ID,
      `v1:fingerprint-${options.id}`,
      options.ciphertext === undefined ? 'encrypted-provider-payload' : options.ciphertext,
      now,
      options.providerId ?? null,
      options.providerId ?? null,
      options.providerId ?? null,
      now,
      now,
      now,
    )
    .run()
}

function deliveryPayload(input: {
  type: string
  createdAt: string
  providerEmailId: string
  jobTag?: string
}): string {
  return JSON.stringify({
    type: input.type,
    created_at: input.createdAt,
    data: {
      created_at: input.createdAt,
      email_id: input.providerEmailId,
      from: 'sender@example.test',
      to: ['private-recipient@example.test'],
      subject: 'Bearer link must not persist',
      tags: input.jobTag === undefined ? {} : { open_events_job: input.jobTag },
    },
  })
}

async function signature(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET_MATERIAL),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  )
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return `v1,${btoa(binary)}`
}

async function postSigned(
  id: string,
  body: string,
  options: {
    timestamp?: string
    signatureBody?: string
    headers?: Record<string, string>
    overrides?: Record<string, unknown>
  } = {},
): Promise<Response> {
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000))
  const signedBody = options.signatureBody ?? body
  return app.request(
    '/api/webhooks/resend',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': await signature(id, timestamp, signedBody),
        ...options.headers,
      },
      body,
    },
    bindings({ RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET, ...options.overrides }),
  )
}

async function providerState(jobId: string): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(
    `SELECT status, provider_id, provider_status, provider_status_at,
            provider_event_id, provider_event_count, ciphertext, nonce, next_attempt_at
     FROM email_delivery_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first()
}

describe('signed Resend webhook', () => {
  it('deduplicates, orders provider evidence, and keeps terminal truth monotonic', async () => {
    await seedJob({ id: 'job-1', providerId: 'provider-1' })
    const delivered = deliveryPayload({
      type: 'email.delivered',
      createdAt: '2026-08-15T12:02:00.000Z',
      providerEmailId: 'provider-1',
    })
    expect((await postSigned('evt-delivered', delivered)).status).toBe(200)
    expect((await postSigned('evt-delivered', delivered)).status).toBe(200)
    expect(await providerState('job-1')).toMatchObject({
      status: 'accepted',
      provider_status: 'delivered',
      provider_event_id: 'evt-delivered',
      provider_event_count: 1,
      ciphertext: null,
      nonce: null,
      next_attempt_at: null,
    })

    const sentEarlier = deliveryPayload({
      type: 'email.sent',
      createdAt: '2026-08-15T12:01:00.000Z',
      providerEmailId: 'provider-1',
    })
    expect((await postSigned('evt-sent', sentEarlier)).status).toBe(200)
    expect(await providerState('job-1')).toMatchObject({
      provider_status: 'delivered',
      provider_event_count: 2,
    })

    const complained = deliveryPayload({
      type: 'email.complained',
      createdAt: '2026-08-15T12:03:00.000Z',
      providerEmailId: 'provider-1',
    })
    const bouncedLater = deliveryPayload({
      type: 'email.bounced',
      createdAt: '2026-08-15T12:04:00.000Z',
      providerEmailId: 'provider-1',
    })
    expect((await postSigned('evt-complained', complained)).status).toBe(200)
    expect((await postSigned('evt-bounced', bouncedLater)).status).toBe(200)
    expect(await providerState('job-1')).toMatchObject({
      provider_status: 'complained',
      provider_event_id: 'evt-complained',
      provider_event_count: 4,
    })

    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM resend_webhook_events').first(),
    ).toEqual({ count: 4 })
    await expect(
      env.DB.prepare(`UPDATE resend_webhook_events SET event_type = 'email.sent'`).run(),
    ).rejects.toThrow('immutable')
    await expect(env.DB.prepare('DELETE FROM resend_webhook_events').run()).rejects.toThrow(
      'immutable',
    )
  })

  it('uses the immutable job tag to resolve an ambiguous provider response', async () => {
    await seedJob({ id: 'job-ambiguous', providerId: null })
    const body = deliveryPayload({
      type: 'email.sent',
      createdAt: '2026-08-15T12:01:00.000Z',
      providerEmailId: 'provider-from-webhook',
      jobTag: 'job-ambiguous',
    })
    expect(await (await postSigned('evt-ambiguous', body)).json()).toEqual({
      received: true,
      matched: true,
    })
    expect(await providerState('job-ambiguous')).toMatchObject({
      provider_id: 'provider-from-webhook',
      provider_status: 'sent',
      ciphertext: null,
      nonce: null,
    })

    const unknown = deliveryPayload({
      type: 'email.sent',
      createdAt: '2026-08-15T12:02:00.000Z',
      providerEmailId: 'unknown-provider',
      jobTag: 'unknown-job',
    })
    expect(await (await postSigned('evt-unmatched', unknown)).json()).toEqual({
      received: true,
      matched: false,
    })
    expect(
      await env.DB.prepare(
        `SELECT id, job_id, provider_email_id, event_type FROM resend_webhook_events
         WHERE id = 'evt-unmatched'`,
      ).first(),
    ).toEqual({
      id: 'evt-unmatched',
      job_id: null,
      provider_email_id: 'unknown-provider',
      event_type: 'email.sent',
    })

    const schema = await env.DB.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'resend_webhook_events'`,
    ).first<{ sql: string }>()
    expect(schema?.sql).not.toMatch(/recipient|subject|body|signature|payload/i)
    const serializedLedger = JSON.stringify(
      (await env.DB.prepare('SELECT * FROM resend_webhook_events').all()).results,
    )
    expect(serializedLedger).not.toContain('private-recipient@example.test')
    expect(serializedLedger).not.toContain('Bearer link must not persist')
  })

  it('rejects unsigned, stale, mutated, non-JSON, oversized, and source-limited requests', async () => {
    const body = deliveryPayload({
      type: 'email.sent',
      createdAt: '2026-08-15T12:01:00.000Z',
      providerEmailId: 'provider-1',
    })
    expect(
      (
        await app.request(
          '/api/webhooks/resend',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body },
          bindings({ RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET }),
        )
      ).status,
    ).toBe(400)
    expect((await postSigned('evt-mutated', body, { signatureBody: `${body} ` })).status).toBe(400)
    expect(
      (
        await postSigned('evt-stale', body, {
          timestamp: String(Math.floor(Date.now() / 1000) - 301),
        })
      ).status,
    ).toBe(400)
    expect(
      (await postSigned('evt-media', body, { headers: { 'content-type': 'text/plain' } })).status,
    ).toBe(415)
    expect(
      (
        await postSigned('evt-oversize', `${body}${' '.repeat(64 * 1024)}`, {
          signatureBody: `${body}${' '.repeat(64 * 1024)}`,
        })
      ).status,
    ).toBe(413)
    expect(
      (
        await postSigned('evt-limited', body, {
          headers: { 'CF-Connecting-IP': '203.0.113.7' },
          overrides: {
            RESEND_WEBHOOK_RATE_LIMITER: { limit: async () => ({ success: false }) },
          },
        })
      ).status,
    ).toBe(429)
    expect(
      (
        await postSigned('evt-missing-secret', body, {
          overrides: { RESEND_WEBHOOK_SECRET: '' },
        })
      ).status,
    ).toBe(503)
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM resend_webhook_events').first(),
    ).toEqual({ count: 0 })
  })

  it('acknowledges authenticated event families that are intentionally not projected', async () => {
    const body = deliveryPayload({
      type: 'email.opened',
      createdAt: '2026-08-15T12:01:00.000Z',
      providerEmailId: 'provider-1',
    })
    expect(await (await postSigned('evt-opened', body)).json()).toEqual({ received: true })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM resend_webhook_events').first(),
    ).toEqual({ count: 0 })
  })
})
