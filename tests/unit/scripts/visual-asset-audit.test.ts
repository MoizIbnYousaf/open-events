import { describe, expect, it } from 'vitest'

import {
  APPROVED_VISUAL_ASSETS,
  auditVisualAssets,
  runVisualAssetAudit,
} from '../../../scripts/audit-visual-assets.mjs'

describe('visual asset allowlist', () => {
  it('covers every shipped image', () => {
    expect(runVisualAssetAudit(process.cwd())).toEqual([])
  })

  it('fails closed when an approval is withdrawn', () => {
    const withoutLogo = APPROVED_VISUAL_ASSETS.filter((path: string) => path !== 'public/logo.png')
    expect(auditVisualAssets(process.cwd(), withoutLogo)).toContain(
      'public/logo.png: visual asset is not approved',
    )
  })
})
