import { describe, expect, it } from 'vitest'

import {
  evaluateFormSubmitGate,
  evaluateSubmitGate,
  isFormAcceptingVersion,
  isCfpOpen,
  isPerIdentityLimitReached,
  isPositiveCap,
  isTotalCapReached,
  validateFormLimits,
  validateFormState,
} from '../../../src/domain'
import { VERSION_ID, createForm, openLimits } from '../helpers/fixtures'

const WINDOWED: Parameters<typeof evaluateSubmitGate>[0] = {
  opensAt: '2026-05-01T00:00:00.000Z',
  closesAt: '2026-06-01T00:00:00.000Z',
  totalCap: 2,
  perIdentityLimit: 1,
}

describe('isCfpOpen', () => {
  it('is always open when both boundaries are null', () => {
    expect(isCfpOpen(openLimits, '2020-01-01T00:00:00.000Z')).toBe(true)
  })

  it('respects open and close instants inclusively/exclusively', () => {
    expect(isCfpOpen(WINDOWED, '2026-04-30T23:59:59.999Z')).toBe(false)
    expect(isCfpOpen(WINDOWED, '2026-05-01T00:00:00.000Z')).toBe(true)
    expect(isCfpOpen(WINDOWED, '2026-06-01T00:00:00.000Z')).toBe(false)
  })
})

describe('cap predicates', () => {
  it('treats null caps as unlimited', () => {
    expect(isTotalCapReached(null, Number.MAX_SAFE_INTEGER)).toBe(false)
    expect(isPerIdentityLimitReached(null, Number.MAX_SAFE_INTEGER)).toBe(false)
  })

  it('marks a cap reached at equality and not before', () => {
    expect(isTotalCapReached(2, 2)).toBe(true)
    expect(isTotalCapReached(2, 1)).toBe(false)
    expect(isPerIdentityLimitReached(1, 1)).toBe(true)
    expect(isPerIdentityLimitReached(1, 0)).toBe(false)
  })
})

describe('evaluateSubmitGate', () => {
  it('allows submission while the CFP is open and under its caps', () => {
    expect(evaluateSubmitGate(WINDOWED, '2026-05-15T00:00:00.000Z', 1, 0)).toEqual({
      allowed: true,
      reason: 'open',
    })
  })

  it('rejects before the open instant', () => {
    expect(evaluateSubmitGate(WINDOWED, '2026-04-30T00:00:00.000Z', 0, 0)).toEqual({
      allowed: false,
      reason: 'not_open_yet',
    })
  })

  it('rejects at and after the close instant', () => {
    expect(evaluateSubmitGate(WINDOWED, '2026-06-01T00:00:00.000Z', 0, 0)).toEqual({
      allowed: false,
      reason: 'closed',
    })
  })

  it('rejects when the total cap is reached', () => {
    expect(evaluateSubmitGate(WINDOWED, '2026-05-15T00:00:00.000Z', 2, 0)).toEqual({
      allowed: false,
      reason: 'total_cap_reached',
    })
  })

  it('rejects when the per-identity limit is reached', () => {
    expect(evaluateSubmitGate(WINDOWED, '2026-05-15T00:00:00.000Z', 1, 1)).toEqual({
      allowed: false,
      reason: 'identity_limit_reached',
    })
  })

  it('never rejects on counts when caps are null', () => {
    expect(evaluateSubmitGate(openLimits, '2026-05-15T00:00:00.000Z', 999, 999)).toEqual({
      allowed: true,
      reason: 'open',
    })
  })

  it('supports one-sided windows', () => {
    const opensOnly = { ...openLimits, opensAt: WINDOWED.opensAt }
    const closesOnly = { ...openLimits, closesAt: WINDOWED.closesAt }

    expect(evaluateSubmitGate(opensOnly, '2026-04-30T00:00:00.000Z', 0, 0).reason).toBe(
      'not_open_yet',
    )
    expect(evaluateSubmitGate(opensOnly, '2026-05-15T00:00:00.000Z', 0, 0).allowed).toBe(true)
    expect(evaluateSubmitGate(closesOnly, '2026-05-15T00:00:00.000Z', 0, 0).allowed).toBe(true)
    expect(evaluateSubmitGate(closesOnly, '2026-06-01T00:00:00.000Z', 0, 0).reason).toBe('closed')
  })
})

describe('validateFormLimits', () => {
  it('accepts null (unlimited) caps and open limits', () => {
    expect(validateFormLimits(openLimits)).toEqual([])
    expect(isPositiveCap(5)).toBe(true)
  })

  it('rejects zero, negative, and fractional caps', () => {
    expect(validateFormLimits({ ...openLimits, totalCap: 0 }).map((issue) => issue.code)).toContain(
      'invalid_cap',
    )
    expect(
      validateFormLimits({ ...openLimits, perIdentityLimit: -1 }).map((issue) => issue.code),
    ).toContain('invalid_cap')
    expect(isPositiveCap(1.5)).toBe(false)
  })

  it('rejects a close instant at or before the open instant', () => {
    const issues = validateFormLimits({
      ...openLimits,
      opensAt: '2026-05-01T00:00:00.000Z',
      closesAt: '2026-05-01T00:00:00.000Z',
    })

    expect(issues.map((issue) => issue.code)).toContain('invalid_date_range')
  })
})

describe('version-bound submit gate', () => {
  const publishedForm = createForm({
    status: 'published',
    publishedVersionId: VERSION_ID,
    limits: openLimits,
  })

  it('accepts only the currently published version of a published form', () => {
    expect(isFormAcceptingVersion(publishedForm, VERSION_ID)).toBe(true)
    expect(isFormAcceptingVersion(publishedForm, 'version-stale')).toBe(false)
    expect(isFormAcceptingVersion(createForm({ status: 'draft' }), VERSION_ID)).toBe(false)
    expect(
      isFormAcceptingVersion(
        createForm({ status: 'published', publishedVersionId: 'version-other' }),
        VERSION_ID,
      ),
    ).toBe(false)
  })

  it('maps version drift and unpublished forms to a deterministic closed outcome', () => {
    expect(
      evaluateFormSubmitGate(publishedForm, 'version-stale', '2026-05-15T00:00:00.000Z', 0, 0),
    ).toEqual({ allowed: false, reason: 'closed' })
    expect(
      evaluateFormSubmitGate(
        createForm({ status: 'draft' }),
        VERSION_ID,
        '2026-05-15T00:00:00.000Z',
        0,
        0,
      ),
    ).toEqual({ allowed: false, reason: 'closed' })
  })

  it('still applies open/close and cap predicates after the version binding', () => {
    expect(
      evaluateFormSubmitGate(publishedForm, VERSION_ID, '2026-05-15T00:00:00.000Z', 0, 0),
    ).toEqual({ allowed: true, reason: 'open' })
    const cappedForm = createForm({
      status: 'published',
      publishedVersionId: VERSION_ID,
      limits: { ...openLimits, totalCap: 1 },
    })
    expect(
      evaluateFormSubmitGate(cappedForm, VERSION_ID, '2026-05-15T00:00:00.000Z', 1, 0).reason,
    ).toBe('total_cap_reached')
  })
})

describe('form state invariant', () => {
  it('requires a published form to carry a version pointer and a draft to have none', () => {
    expect(
      validateFormState(createForm({ status: 'published', publishedVersionId: null })).map(
        (issue) => issue.code,
      ),
    ).toContain('published_without_version')
    expect(
      validateFormState(createForm({ status: 'draft', publishedVersionId: VERSION_ID })).map(
        (issue) => issue.code,
      ),
    ).toContain('draft_with_published_version')
    expect(
      validateFormState(createForm({ status: 'published', publishedVersionId: VERSION_ID })),
    ).toEqual([])
    expect(validateFormState(createForm({ status: 'draft' }))).toEqual([])
  })
})
