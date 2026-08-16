import { describe, expect, it, vi } from 'vitest'

import {
  TURNSTILE_ALWAYS_PASS_SECRET,
  TURNSTILE_DUMMY_TOKEN,
  verifyTurnstile,
} from '../../../src/server/turnstile'
import { turnstileRemoteAddress } from '../../../src/server/rate-limit'

describe('server-side Turnstile verification', () => {
  it('requires success plus the expected action and hostname', async () => {
    let capturedInit: RequestInit | undefined
    const fetchSiteverify = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return new Response(
        JSON.stringify({ success: true, action: 'public_start', hostname: 'openevents.engineer' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    await expect(
      verifyTurnstile({
        token: 'opaque-token',
        secret: 'production-secret',
        remoteAddress: '203.0.113.4',
        expectedAction: 'public_start',
        expectedHostnames: ['openevents.engineer'],
        fetchSiteverify,
      }),
    ).resolves.toBe(true)

    expect(fetchSiteverify).toHaveBeenCalledTimes(1)
    expect(capturedInit?.method).toBe('POST')
    expect(String(capturedInit?.body)).not.toContain('undefined')
  })

  it('rejects bypass, wrong-action, wrong-host, duplicate, and provider failures', async () => {
    const responseFor =
      (body: unknown, status = 200) =>
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    const base = {
      secret: 'production-secret',
      remoteAddress: '203.0.113.4',
      expectedAction: 'public_start',
      expectedHostnames: ['openevents.engineer'] as const,
    }

    await expect(verifyTurnstile({ ...base, token: '' })).resolves.toBe(false)
    await expect(
      verifyTurnstile({
        ...base,
        token: 'wrong-action',
        fetchSiteverify: responseFor({
          success: true,
          action: 'other',
          hostname: 'openevents.engineer',
        }),
      }),
    ).resolves.toBe(false)
    await expect(
      verifyTurnstile({
        ...base,
        token: 'wrong-host',
        fetchSiteverify: responseFor({
          success: true,
          action: 'public_start',
          hostname: 'evil.example',
        }),
      }),
    ).resolves.toBe(false)
    await expect(
      verifyTurnstile({
        ...base,
        token: 'duplicate',
        fetchSiteverify: responseFor({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
      }),
    ).resolves.toBe(false)
    await expect(
      verifyTurnstile({
        ...base,
        token: 'provider-error',
        fetchSiteverify: responseFor({}, 503),
      }),
    ).resolves.toBe(false)
  })

  it('uses the official deterministic adapter only for local and acceptance hosts', async () => {
    await expect(
      verifyTurnstile({
        token: TURNSTILE_DUMMY_TOKEN,
        secret: TURNSTILE_ALWAYS_PASS_SECRET,
        remoteAddress: '127.0.0.1',
        expectedAction: 'public_start',
        expectedHostnames: ['localhost'],
      }),
    ).resolves.toBe(true)
    await expect(
      verifyTurnstile({
        token: TURNSTILE_DUMMY_TOKEN,
        secret: TURNSTILE_ALWAYS_PASS_SECRET,
        remoteAddress: '203.0.113.4',
        expectedAction: 'public_start',
        expectedHostnames: ['open-events-acceptance.speakerops.workers.dev'],
      }),
    ).resolves.toBe(true)
    await expect(
      verifyTurnstile({
        token: TURNSTILE_DUMMY_TOKEN,
        secret: TURNSTILE_ALWAYS_PASS_SECRET,
        remoteAddress: '127.0.0.1',
        expectedAction: 'public_start',
        expectedHostnames: ['openevents.engineer'],
      }),
    ).resolves.toBe(false)
    await expect(
      verifyTurnstile({
        token: TURNSTILE_DUMMY_TOKEN,
        secret: TURNSTILE_ALWAYS_PASS_SECRET,
        remoteAddress: '203.0.113.4',
        expectedAction: 'public_start',
        expectedHostnames: ['open-events-acceptance.speakerops.workers.dev', 'openevents.engineer'],
      }),
    ).resolves.toBe(false)
  })

  it('omits remoteip when no separately validated raw address is available', async () => {
    let capturedBody = ''
    const fetchSiteverify = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body)
      return new Response(
        JSON.stringify({ success: true, action: 'public_start', hostname: 'openevents.engineer' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    await verifyTurnstile({
      token: 'opaque-token',
      secret: 'production-secret',
      expectedAction: 'public_start',
      expectedHostnames: ['openevents.engineer'],
      fetchSiteverify,
    })

    expect(new URLSearchParams(capturedBody).has('remoteip')).toBe(false)
  })

  it('keeps the raw validated IPv6 address separate from its limiter /64 bucket', () => {
    const raw = '2001:db8:abcd:12:1111:2222:3333:4444'
    expect(turnstileRemoteAddress(raw)).toBe(raw)
    expect(turnstileRemoteAddress(raw)).not.toContain('/64')
    expect(turnstileRemoteAddress('not-an-address')).toBeUndefined()
  })
})
