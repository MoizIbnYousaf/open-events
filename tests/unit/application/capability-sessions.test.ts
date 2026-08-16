import { describe, expect, it } from 'vitest'

import {
  assertSubmitterCapability,
  canUseLegacyCapabilityRow,
  markValidatedLegacySession,
  toSubmitterActor,
} from '../../../src/application'
import type { SessionCapability, SubmitterSession } from '../../../src/domain'
import { FIXED_NOW, createSubmitterSession, createSubmitterToken } from '../helpers/fixtures'

describe('purpose-bound submitter access', () => {
  it.each<SessionCapability>(['cfp', 'portal', 'evaluation'])(
    'preserves the %s capability in the non-forgeable actor',
    (capability) => {
      const actor = toSubmitterActor(createSubmitterSession({ capability }))
      expect(actor?.capability).toBe(capability)
    },
  )

  it('rejects arbitrary null actors and explicitly marks bounded legacy broad authority', () => {
    const legacy: SubmitterSession = createSubmitterSession({ capability: null })
    expect(toSubmitterActor(legacy)).toBeNull()
    const actor = toSubmitterActor(
      markValidatedLegacySession(legacy as SubmitterSession & { readonly capability: null }),
    )
    if (actor === null) throw new Error('expected legacy actor')
    expect(actor.capability).toBeNull()
    expect(actor.legacyBroadAuthority).toBe(true)
    for (const capability of ['cfp', 'portal', 'evaluation'] as const) {
      expect(() => assertSubmitterCapability(actor, capability)).not.toThrow()
    }
  })

  it('uses separate token and session compatibility horizons and denies post-cutover nulls', () => {
    const cutoff = '2026-08-15T12:00:00.000Z'
    expect(
      canUseLegacyCapabilityRow(
        createSubmitterToken({ purpose: null, createdAt: '2026-08-15T11:59:59.000Z' }),
        '2026-08-16T11:59:59.000Z',
        cutoff,
        24 * 60 * 60 * 1000,
      ),
    ).toBe(true)
    expect(
      canUseLegacyCapabilityRow(
        createSubmitterToken({ purpose: null, createdAt: '2026-08-15T11:59:59.000Z' }),
        '2026-08-16T12:00:00.001Z',
        cutoff,
        24 * 60 * 60 * 1000,
      ),
    ).toBe(false)
    expect(
      canUseLegacyCapabilityRow(
        createSubmitterSession({
          capability: null,
          createdAt: '2026-08-15T11:59:59.000Z',
        }),
        '2026-08-15T11:59:58.000Z',
        cutoff,
        30 * 24 * 60 * 60 * 1000,
      ),
    ).toBe(false)
    expect(
      canUseLegacyCapabilityRow(
        createSubmitterSession({ capability: null, createdAt: '2026-08-15T11:59:59.000Z' }),
        '2026-09-14T11:59:59.000Z',
        cutoff,
        30 * 24 * 60 * 60 * 1000,
      ),
    ).toBe(true)
    expect(
      canUseLegacyCapabilityRow(
        createSubmitterSession({ capability: null, createdAt: '2026-08-15T12:00:00.001Z' }),
        FIXED_NOW,
        cutoff,
        30 * 24 * 60 * 60 * 1000,
      ),
    ).toBe(false)
    expect(
      canUseLegacyCapabilityRow(
        createSubmitterSession({ capability: null }),
        FIXED_NOW,
        null,
        30 * 24 * 60 * 60 * 1000,
      ),
    ).toBe(false)
  })
})
