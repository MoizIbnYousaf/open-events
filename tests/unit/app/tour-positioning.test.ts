import { describe, expect, it } from 'vitest'

import { computeTourPlacement } from '../../../src/app/features/tour/tour-positioning'

describe('tour placement', () => {
  it('uses measured popover height and chooses a non-overlapping side', () => {
    const placement = computeTourPlacement(
      { top: 200, left: 400, width: 200, height: 80 },
      { width: 344, height: 330 },
      { width: 1440, height: 900 },
    )
    expect(placement.mode).not.toBe('center')
    expect(placement.top).toBeGreaterThanOrEqual(8)
    expect(placement.left).toBeGreaterThanOrEqual(8)
    expect(placement.top + 330).toBeLessThanOrEqual(892)
  })

  it('docks inside a short phone viewport with an internal height budget', () => {
    const placement = computeTourPlacement(
      { top: 120, left: 16, width: 288, height: 48 },
      { width: 344, height: 410 },
      { width: 320, height: 568 },
    )
    expect(placement).toMatchObject({ mode: 'dock', left: 8, width: 304 })
    expect(placement.maxHeight).toBe(552)
  })

  it('centers a moment without a target inside the visual viewport', () => {
    expect(
      computeTourPlacement(null, { width: 344, height: 260 }, { width: 390, height: 844 }),
    ).toMatchObject({ mode: 'center', width: 344 })
  })
})
