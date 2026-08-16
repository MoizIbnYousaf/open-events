import { describe, expect, it } from 'vitest'

import {
  projectEmailDeliveryEvents,
  type ResendDeliveryEvent,
  type ResendDeliveryEventType,
} from '../../../src/application'

function event(id: string, type: ResendDeliveryEventType, createdAt: string): ResendDeliveryEvent {
  return {
    id,
    type,
    createdAt,
    receivedAt: '2026-08-15T13:00:00.000Z',
    providerEmailId: 'provider-1',
    jobTag: null,
  }
}

describe('Resend delivery projection', () => {
  it('folds out-of-order arrivals by provider time and then event id', () => {
    const sent = event('a-sent', 'email.sent', '2026-08-15T12:00:00.000Z')
    const delivered = event('b-delivered', 'email.delivered', '2026-08-15T12:01:00.000Z')

    expect(projectEmailDeliveryEvents([delivered, sent])).toEqual({
      status: 'delivered',
      at: delivered.createdAt,
      eventId: delivered.id,
    })
    expect(projectEmailDeliveryEvents([sent, delivered])).toEqual(
      projectEmailDeliveryEvents([delivered, sent]),
    )
  })

  it('uses event id as the deterministic tie breaker', () => {
    const at = '2026-08-15T12:00:00.000Z'
    const delivered = event('a-delivered', 'email.delivered', at)
    const bounced = event('b-bounced', 'email.bounced', at)
    expect(projectEmailDeliveryEvents([bounced, delivered]).status).toBe('delivered')
  })

  it('allows complaint after delivery while keeping every failure outcome terminal', () => {
    const delivered = event('1', 'email.delivered', '2026-08-15T12:00:00.000Z')
    const complained = event('2', 'email.complained', '2026-08-15T12:01:00.000Z')
    const lateBounce = event('3', 'email.bounced', '2026-08-15T12:02:00.000Z')
    expect(projectEmailDeliveryEvents([lateBounce, complained, delivered]).status).toBe(
      'complained',
    )

    for (const terminal of ['email.bounced', 'email.failed', 'email.suppressed'] as const) {
      expect(
        projectEmailDeliveryEvents([
          event('a', terminal, '2026-08-15T12:00:00.000Z'),
          event('b', 'email.delivered', '2026-08-15T12:01:00.000Z'),
        ]).status,
      ).toBe(terminal === 'email.bounced' ? 'bounced' : 'failed')
    }
  })

  it('lets a delayed message recover through sent to delivered', () => {
    expect(
      projectEmailDeliveryEvents([
        event('1', 'email.delivery_delayed', '2026-08-15T12:00:00.000Z'),
        event('2', 'email.sent', '2026-08-15T12:01:00.000Z'),
        event('3', 'email.delivered', '2026-08-15T12:02:00.000Z'),
      ]).status,
    ).toBe('delivered')
  })
})
