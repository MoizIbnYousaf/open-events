import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createResendEmailSender,
  capturingEmailSender,
  selectEmailSender,
} from '../../../src/server/email'

/**
 * Delivery is a second, failable act on top of the captured-message log.
 *
 * The log is the record of what the product said; delivery is whether it left
 * the building. Keeping them apart is what lets the whole suite capture without
 * sending, and what makes a provider outage a delivery problem rather than a
 * lost proposal.
 */
describe('outbound email', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('captures without delivering when no provider is configured', () => {
    // The DEFAULT is the safe one. A product that mails real people the moment
    // someone runs the suite is a product nobody can safely develop.
    expect(selectEmailSender({ EMAIL_DELIVERY_MODE: 'capture' })).toBe(capturingEmailSender)
  })

  it('fails closed when a provider mode is incomplete', () => {
    expect(() =>
      selectEmailSender({ EMAIL_DELIVERY_MODE: 'resend-live', RESEND_API_KEY: 'k' }),
    ).toThrow('email delivery')
  })

  it('uses the reviewed client identity, provider idempotency key, and correlation tag', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ id: 'provider-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Open Events <events@example.test>',
    })
    await expect(
      sender.send({
        jobId: 'job-123',
        mode: 'resend-test',
        to: 'delivered@resend.dev',
        subject: 'Your link',
        body: 'Open this',
      }),
    ).resolves.toEqual({ outcome: 'accepted', providerId: 'provider-1' })

    expect(calls).toHaveLength(1)
    const request = calls[0]
    expect(request?.url).toBe('https://api.resend.com/emails')
    const headers = new Headers(request?.init.headers)
    expect(headers.get('user-agent')).toContain('open-events')
    expect(headers.get('authorization')).toBe('Bearer re_test')
    expect(headers.get('idempotency-key')).toBe('job-123')
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      from: 'Open Events <events@example.test>',
      to: ['delivered@resend.dev'],
      subject: 'Your link',
      text: 'Open this',
      tags: [{ name: 'open_events_job', value: 'job-123' }],
    })
  })

  it('classifies 429 with Retry-After for a durable retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'rate_limit_exceeded',
              statusCode: 429,
              message: 'Slow down',
            }),
            { status: 429, headers: { 'retry-after': '17' } },
          ),
      ),
    )
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Open Events <events@example.test>',
    })

    await expect(
      sender.send({
        jobId: 'job-1',
        mode: 'resend-test',
        to: 'delivered@resend.dev',
        subject: 'S',
        body: 'B',
      }),
    ).resolves.toEqual({
      outcome: 'retry',
      code: 'rate_limit_exceeded',
      retryAfterSeconds: 17,
    })
  })

  it('classifies provider 5xx responses for a durable retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'application_error',
              statusCode: 503,
              message: 'Unavailable',
            }),
            { status: 503 },
          ),
      ),
    )
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Open Events <events@example.test>',
    })

    await expect(
      sender.send({
        jobId: 'job-503',
        mode: 'resend-test',
        to: 'delivered@resend.dev',
        subject: 'S',
        body: 'B',
      }),
    ).resolves.toEqual({ outcome: 'retry', code: 'application_error' })
  })

  it('stops automatic retries for permanent provider rejection and treats network loss as ambiguous', async () => {
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Open Events <events@example.test>',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'invalid_from_address',
              statusCode: 422,
              message: 'Invalid sender',
            }),
            { status: 422 },
          ),
      ),
    )
    await expect(
      sender.send({
        jobId: 'job-1',
        mode: 'resend-test',
        to: 'delivered@resend.dev',
        subject: 'S',
        body: 'B',
      }),
    ).resolves.toEqual({ outcome: 'operator_action', code: 'invalid_from_address' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('network'))),
    )
    await expect(
      sender.send({
        jobId: 'job-2',
        mode: 'resend-test',
        to: 'delivered@resend.dev',
        subject: 'S',
        body: 'B',
      }),
    ).resolves.toEqual({ outcome: 'ambiguous', code: 'application_error' })
  })

  it('blocks ordinary recipients in provider test mode before any network call', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'Open Events <events@example.test>',
    })

    await expect(
      sender.send({
        jobId: 'job-1',
        mode: 'resend-test',
        to: 'person@gmail.com',
        subject: 'No',
        body: 'No',
      }),
    ).resolves.toEqual({ outcome: 'operator_action', code: 'test_recipient_denied' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
