import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import app from '../../src/server'
import { EmailDeliveryService, type EmailSender } from '../../src/application'
import {
  createCapturedMessageRepository,
  createEmailDeliveryRepository,
  DEMO_CONF_2026_ID,
} from '../../src/db'
import {
  TEST_EMAIL_DELIVERY_CONFIG,
  applyMigrations,
  latestCapturedBody,
  seedDemoConf,
} from './m2b-helpers'
import { TURNSTILE_DUMMY_TOKEN, bindings } from './m2c-helpers'
import { runScheduledEmailDrain } from '../../src/server/email-drain'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function start(email: string, overrides: Record<string, unknown> = {}): Promise<Response> {
  return app.request(
    '/api/public/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        eventSlug: 'demo-conf-2026',
        formSlug: 'cfp',
        turnstileToken: TURNSTILE_DUMMY_TOKEN,
      }),
    },
    bindings(overrides),
  )
}

describe('transactional email outbox', () => {
  it('atomically creates a terminal capture job while keeping its audit row redacted', async () => {
    expect((await start('speaker-a@example.test')).status).toBe(202)

    const audit = await env.DB.prepare(
      `SELECT to_email, body, recipient_fingerprint FROM captured_messages ORDER BY rowid DESC LIMIT 1`,
    ).first<{ to_email: string; body: string; recipient_fingerprint: string }>()
    expect(audit?.to_email).toBe('s***@example.test')
    expect(audit?.body).not.toContain('token=')
    expect(audit?.recipient_fingerprint).toMatch(/^v1:/)

    const job = await env.DB.prepare(
      `SELECT mode, status, ciphertext, nonce, attempts, provider_id
       FROM email_delivery_jobs ORDER BY rowid DESC LIMIT 1`,
    ).first<{
      mode: string
      status: string
      ciphertext: string
      nonce: string
      attempts: number
      provider_id: string | null
    }>()
    expect(job).toMatchObject({
      mode: 'capture',
      status: 'captured',
      attempts: 0,
      provider_id: null,
    })
    expect(job?.ciphertext).not.toContain('speaker-a@example.test')
    expect(job?.ciphertext).not.toContain('token=')
    expect(job?.nonce).toBeTruthy()
    expect(await latestCapturedBody(env.DB, 'speaker-a@example.test')).toContain('token=')
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM email_delivery_budget_events').first(),
    ).toEqual({ count: 0 })
    await expect(
      env.DB.prepare(`UPDATE captured_messages SET subject = 'rewritten'`).run(),
    ).rejects.toThrow('immutable')
    await expect(env.DB.prepare(`DELETE FROM captured_messages`).run()).rejects.toThrow('immutable')
  })

  it('snapshots provider-test mode and reserves global capacity without sending inline', async () => {
    expect(
      (
        await start('delivered@resend.dev', {
          EMAIL_DELIVERY_MODE: 'resend-test',
          RESEND_API_KEY: 're_test',
          EMAIL_FROM: 'Open Events <events@example.test>',
        })
      ).status,
    ).toBe(202)

    expect(
      await env.DB.prepare(
        `SELECT mode, status, attempts FROM email_delivery_jobs ORDER BY rowid DESC LIMIT 1`,
      ).first(),
    ).toEqual({ mode: 'resend-test', status: 'queued', attempts: 0 })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM email_delivery_budget_events').first(),
    ).toEqual({ count: 1 })
  })

  it('drains only jobs whose immutable provider mode matches the active deployment', async () => {
    expect(
      (
        await start('delivered@resend.dev', {
          EMAIL_DELIVERY_MODE: 'resend-test',
          RESEND_API_KEY: 're_test',
          EMAIL_FROM: 'Open Events <events@example.test>',
        })
      ).status,
    ).toBe(202)
    expect(
      (
        await start('bounced@resend.dev', {
          EMAIL_DELIVERY_MODE: 'resend-live',
          EMAIL_LIVE_VERIFIED_AT: '2026-08-15T12:00:00.000Z',
          RESEND_API_KEY: 're_live',
          RESEND_WEBHOOK_SECRET: 'whsec_test',
          EMAIL_FROM: 'Open Events <events@example.test>',
        })
      ).status,
    ).toBe(202)

    const modes: string[] = []
    const sender: EmailSender = {
      async send(email) {
        modes.push(email.mode)
        return { outcome: 'accepted', providerId: `provider-${email.mode}` }
      },
    }
    const repository = createEmailDeliveryRepository(env.DB)
    const clock = { now: () => new Date().toISOString() }

    expect(
      await new EmailDeliveryService(repository, sender, TEST_EMAIL_DELIVERY_CONFIG, clock).drain(),
    ).toMatchObject({ claimed: 0 })
    expect(
      await new EmailDeliveryService(
        repository,
        sender,
        { ...TEST_EMAIL_DELIVERY_CONFIG, mode: 'resend-test' },
        clock,
      ).drain(),
    ).toMatchObject({ claimed: 1, accepted: 1 })
    expect(modes).toEqual(['resend-test'])
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM email_delivery_jobs
         WHERE mode = 'resend-live' AND status = 'queued'`,
      ).first(),
    ).toEqual({ count: 1 })

    expect(
      await new EmailDeliveryService(
        repository,
        sender,
        { ...TEST_EMAIL_DELIVERY_CONFIG, mode: 'resend-live' },
        clock,
      ).drain(),
    ).toMatchObject({ claimed: 1, accepted: 1 })
    expect(modes).toEqual(['resend-test', 'resend-live'])
  })

  it('does not backfill historical captured rows into sendable jobs', async () => {
    await env.DB.prepare(
      `INSERT INTO captured_messages (id, event_id, to_email, subject, body, created_at)
       VALUES ('historical', ?, 'old@example.test', 'Old', 'Old body',
               '2026-01-01T00:00:00.000Z')`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()

    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM email_delivery_jobs WHERE captured_message_id = 'historical'`,
      ).first(),
    ).toEqual({ count: 0 })
  })

  it('allows concurrent drains to claim one provider request and clears accepted payloads', async () => {
    await start('delivered@resend.dev', {
      EMAIL_DELIVERY_MODE: 'resend-test',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Open Events <events@example.test>',
    })
    let calls = 0
    const sender: EmailSender = {
      async send() {
        calls += 1
        return { outcome: 'accepted', providerId: 'provider-once' }
      },
    }
    const config = { ...TEST_EMAIL_DELIVERY_CONFIG, mode: 'resend-test' as const }
    const repository = createEmailDeliveryRepository(env.DB)
    const now = new Date().toISOString()
    const first = new EmailDeliveryService(repository, sender, config, { now: () => now })
    const second = new EmailDeliveryService(repository, sender, config, { now: () => now })

    const summaries = await Promise.all([
      first.drain({ owner: 'drain-a' }),
      second.drain({ owner: 'drain-b' }),
    ])

    expect(summaries.reduce((total, summary) => total + summary.claimed, 0)).toBe(1)
    expect(calls).toBe(1)
    expect(
      await env.DB.prepare(
        `SELECT status, provider_id, ciphertext, nonce, attempts FROM email_delivery_jobs`,
      ).first(),
    ).toEqual({
      status: 'accepted',
      provider_id: 'provider-once',
      ciphertext: null,
      nonce: null,
      attempts: 1,
    })
  })

  it('keeps an overlapping Cron recovery drain and immediate drain exactly once', async () => {
    await start('delivered@resend.dev', {
      EMAIL_DELIVERY_MODE: 'resend-test',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Open Events <events@example.test>',
    })
    let calls = 0
    const sender: EmailSender = {
      async send() {
        calls += 1
        return { outcome: 'accepted', providerId: 'provider-cron-once' }
      },
    }
    const providerBindings = bindings({
      EMAIL_DELIVERY_MODE: 'resend-test',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Open Events <events@example.test>',
    })
    const immediate = new EmailDeliveryService(
      createEmailDeliveryRepository(env.DB),
      sender,
      { ...TEST_EMAIL_DELIVERY_CONFIG, mode: 'resend-test' },
      { now: () => new Date().toISOString() },
    )

    const [scheduled, request] = await Promise.all([
      runScheduledEmailDrain(providerBindings as never, sender),
      immediate.drain({ owner: 'request-drain' }),
    ])

    expect((scheduled?.claimed ?? 0) + request.claimed).toBe(1)
    expect(calls).toBe(1)
    expect(
      await env.DB.prepare('SELECT status, provider_id, attempts FROM email_delivery_jobs').first(),
    ).toEqual({ status: 'accepted', provider_id: 'provider-cron-once', attempts: 1 })
  })

  it('recovers a stale lease and schedules a bounded provider retry', async () => {
    await start('delivered@resend.dev', {
      EMAIL_DELIVERY_MODE: 'resend-test',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Open Events <events@example.test>',
    })
    await env.DB.prepare(
      `UPDATE email_delivery_jobs
       SET status = 'leased', lease_owner = 'dead', lease_expires_at = '2020-01-01T00:00:00.000Z'`,
    ).run()
    const sender: EmailSender = {
      async send() {
        return { outcome: 'retry', code: 'rate_limit_exceeded', retryAfterSeconds: 120 }
      },
    }
    const now = new Date().toISOString()
    const service = new EmailDeliveryService(
      createEmailDeliveryRepository(env.DB),
      sender,
      { ...TEST_EMAIL_DELIVERY_CONFIG, mode: 'resend-test' },
      { now: () => now },
    )

    expect(await service.drain({ owner: 'recovery' })).toMatchObject({ claimed: 1, retried: 1 })
    const job = await env.DB.prepare(
      `SELECT status, attempts, next_attempt_at, lease_owner, last_error_code
       FROM email_delivery_jobs`,
    ).first<{
      status: string
      attempts: number
      next_attempt_at: string
      lease_owner: string | null
      last_error_code: string
    }>()
    expect(job).toMatchObject({
      status: 'retry',
      attempts: 1,
      lease_owner: null,
      last_error_code: 'rate_limit_exceeded',
    })
    expect(Date.parse(job?.next_attempt_at ?? '') - Date.parse(now)).toBe(120_000)
  })

  it('expires protected payloads without calling the provider', async () => {
    await start('delivered@resend.dev', {
      EMAIL_DELIVERY_MODE: 'resend-test',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Open Events <events@example.test>',
    })
    await env.DB.prepare(
      `UPDATE email_delivery_jobs SET payload_expires_at = '2020-01-01T00:00:00.000Z'`,
    ).run()
    let calls = 0
    const sender: EmailSender = {
      async send() {
        calls += 1
        return { outcome: 'accepted', providerId: 'must-not-send' }
      },
    }
    const service = new EmailDeliveryService(
      createEmailDeliveryRepository(env.DB),
      sender,
      { ...TEST_EMAIL_DELIVERY_CONFIG, mode: 'resend-test' },
      { now: () => '2026-08-15T12:00:00.000Z' },
    )

    expect(await service.drain()).toMatchObject({ claimed: 0, expired: 1 })
    expect(calls).toBe(0)
    expect(
      await env.DB.prepare(
        `SELECT status, last_error_code, ciphertext, nonce FROM email_delivery_jobs`,
      ).first(),
    ).toEqual({
      status: 'operator_action',
      last_error_code: 'payload_expired',
      ciphertext: null,
      nonce: null,
    })
  })

  it('stops safely and clears a payload that cannot be authenticated', async () => {
    await start('delivered@resend.dev', {
      EMAIL_DELIVERY_MODE: 'resend-test',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Open Events <events@example.test>',
    })
    await env.DB.prepare(`UPDATE email_delivery_jobs SET ciphertext = 'tampered'`).run()
    let calls = 0
    const sender: EmailSender = {
      async send() {
        calls += 1
        return { outcome: 'accepted', providerId: 'must-not-send' }
      },
    }
    const service = new EmailDeliveryService(
      createEmailDeliveryRepository(env.DB),
      sender,
      { ...TEST_EMAIL_DELIVERY_CONFIG, mode: 'resend-test' },
      { now: () => new Date().toISOString() },
    )

    expect(await service.drain()).toMatchObject({ claimed: 1, operatorAction: 1 })
    expect(calls).toBe(0)
    expect(
      await env.DB.prepare(
        `SELECT status, last_error_code, ciphertext, nonce FROM email_delivery_jobs`,
      ).first(),
    ).toEqual({
      status: 'operator_action',
      last_error_code: 'payload_decryption_failed',
      ciphertext: null,
      nonce: null,
    })
  })

  it('does not automatically retry an ambiguous request after the provider idempotency window', async () => {
    await start('delivered@resend.dev', {
      EMAIL_DELIVERY_MODE: 'resend-test',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Open Events <events@example.test>',
    })
    const original = await env.DB.prepare(`SELECT created_at FROM email_delivery_jobs`).first<{
      created_at: string
    }>()
    if (original === null) throw new Error('missing queued delivery job')
    const now = new Date(Date.parse(original.created_at) + 1).toISOString()
    const outsideWindow = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString()
    await env.DB.prepare(`UPDATE email_delivery_jobs SET created_at = ?, next_attempt_at = NULL`)
      .bind(outsideWindow)
      .run()
    const sender: EmailSender = {
      async send() {
        return { outcome: 'ambiguous', code: 'network_outcome_unknown' }
      },
    }
    const service = new EmailDeliveryService(
      createEmailDeliveryRepository(env.DB),
      sender,
      { ...TEST_EMAIL_DELIVERY_CONFIG, mode: 'resend-test' },
      { now: () => now },
    )

    expect(await service.drain()).toMatchObject({ claimed: 1, operatorAction: 1 })
    expect(
      await env.DB.prepare(
        `SELECT status, last_error_code, next_attempt_at FROM email_delivery_jobs`,
      ).first(),
    ).toEqual({
      status: 'operator_action',
      last_error_code: 'idempotency_window_expired',
      next_attempt_at: null,
    })
  })

  async function seedDeliveryBudget(count: number, organizerKey: string | null): Promise<void> {
    const at = '2026-08-15T12:00:00.000Z'
    await env.DB.prepare(
      `WITH RECURSIVE seq(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
       )
       INSERT INTO captured_messages
         (id, event_id, to_email, subject, body, created_at, recipient_fingerprint)
       SELECT 'budget-message-' || n, ?, 'r***@example.test', 'Budget', 'Protected', ?,
              'v1:budget-' || n
       FROM seq`,
    )
      .bind(count, DEMO_CONF_2026_ID, at)
      .run()
    await env.DB.prepare(
      `WITH RECURSIVE seq(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
       )
       INSERT INTO email_delivery_jobs
         (id, captured_message_id, event_id, mode, status, recipient_fingerprint,
          key_version, nonce, ciphertext, payload_expires_at, attempts, created_at, updated_at)
       SELECT 'budget-job-' || n, 'budget-message-' || n, ?, 'resend-test', 'accepted',
              'v1:budget-' || n, 'v1', NULL, NULL, '2026-08-16T12:00:00.000Z', 1, ?, ?
       FROM seq`,
    )
      .bind(count, DEMO_CONF_2026_ID, at, at)
      .run()
    await env.DB.prepare(
      `WITH RECURSIVE seq(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
       )
       INSERT INTO email_delivery_budget_events
         (job_id, environment_key, organizer_key, created_at)
       SELECT 'budget-job-' || n, 'test', ?, ? FROM seq`,
    )
      .bind(count, organizerKey, at)
      .run()
  }

  it('turns a provider intent into operator action at the global rolling budget', async () => {
    await seedDeliveryBudget(250, null)
    expect(
      (
        await start('delivered@resend.dev', {
          EMAIL_DELIVERY_MODE: 'resend-test',
          RESEND_API_KEY: 're_test',
          EMAIL_FROM: 'Open Events <events@example.test>',
        })
      ).status,
    ).toBe(202)

    expect(
      await env.DB.prepare(
        `SELECT status, last_error_code FROM email_delivery_jobs
         WHERE id NOT LIKE 'budget-job-%'`,
      ).first(),
    ).toEqual({ status: 'operator_action', last_error_code: 'global_budget_exhausted' })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM email_delivery_budget_events').first(),
    ).toEqual({ count: 250 })
  })

  it('enforces the organizer event budget atomically with an ordinary message job', async () => {
    const organizerKey = `test:event:${DEMO_CONF_2026_ID}`
    await seedDeliveryBudget(100, organizerKey)
    await createCapturedMessageRepository(env.DB, {
      ...TEST_EMAIL_DELIVERY_CONFIG,
      mode: 'resend-test',
    }).save({
      id: 'organizer-over-budget',
      eventId: DEMO_CONF_2026_ID,
      toEmail: 'delivered@resend.dev',
      subject: 'Reminder',
      body: 'Reminder body',
      createdAt: '2026-08-15T12:00:01.000Z',
      kind: 'reminder',
      deliveryBudgetClass: 'organizer',
    })

    expect(
      await env.DB.prepare(`SELECT status, last_error_code FROM email_delivery_jobs WHERE id = ?`)
        .bind('organizer-over-budget')
        .first(),
    ).toEqual({ status: 'operator_action', last_error_code: 'organizer_budget_exhausted' })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM email_delivery_budget_events').first(),
    ).toEqual({ count: 100 })
  })
})
