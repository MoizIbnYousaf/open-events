import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  capturingEmailSender,
  createResendEmailSender,
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
    expect(selectEmailSender({})).toBe(capturingEmailSender)
  })

  it('refuses to deliver with a key but no From address', () => {
    // Loudly capture-only rather than discovering it one rejected message at a
    // time: a key without a From address cannot send anything.
    expect(selectEmailSender({ RESEND_API_KEY: 'k' })).toBe(capturingEmailSender)
  })

  it('delivers through the provider when both are configured', async () => {
    const calls: { url: string; body: unknown }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) })
        return new Response('{}', { status: 200 })
      }),
    )

    const sender = selectEmailSender({ RESEND_API_KEY: 'k', EMAIL_FROM: 'cfp@example.test' })
    await sender.send({ to: 'ada@example.test', subject: 'Your link', body: 'Open this' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.resend.com/emails')
    expect(calls[0]?.body).toMatchObject({
      from: 'cfp@example.test',
      to: ['ada@example.test'],
      subject: 'Your link',
    })
  })

  it('never throws when the provider refuses or the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 422 })),
    )
    const refused = createResendEmailSender({ apiKey: 'k', from: 'cfp@example.test' })
    // A speaker has submitted their proposal whether or not the confirmation
    // was delivered, so this must not be able to fail the request behind it.
    await expect(
      refused.send({ to: 'a@example.test', subject: 's', body: 'b' }),
    ).resolves.toBeUndefined()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const broken = createResendEmailSender({ apiKey: 'k', from: 'cfp@example.test' })
    await expect(
      broken.send({ to: 'a@example.test', subject: 's', body: 'b' }),
    ).resolves.toBeUndefined()
  })
})
