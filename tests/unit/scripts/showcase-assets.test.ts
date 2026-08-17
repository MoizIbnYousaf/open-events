import { describe, expect, it } from 'vitest'

// @ts-expect-error scripts/showcase-assets.mjs is a narrow plain-ESM script boundary.
import { SHOWCASE_ASSETS, SHOWCASE_R2_PREFIX } from '../../../scripts/showcase-assets.mjs'

describe('showcase R2 assets', () => {
  it('defines one real headshot and both current and historical deck objects', () => {
    expect(SHOWCASE_ASSETS.map((asset: { readonly key: string }) => asset.key)).toEqual([
      `${SHOWCASE_R2_PREFIX}/headshot/showcase-current`,
      `${SHOWCASE_R2_PREFIX}/document/showcase-current`,
      `${SHOWCASE_R2_PREFIX}/document/showcase-v1`,
    ])
  })

  it('keeps metadata lengths and inert file signatures deterministic', () => {
    const [headshot, currentDeck, previousDeck] = SHOWCASE_ASSETS

    expect(headshot.body).toHaveLength(68)
    expect(headshot.body.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    expect(currentDeck.body).toHaveLength(76)
    expect(currentDeck.body.toString('utf8')).toMatch(/^%PDF-1\.4/)
    expect(previousDeck.body).toEqual(currentDeck.body)
  })
})
