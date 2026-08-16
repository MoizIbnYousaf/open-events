import { describe, expect, it } from 'vitest'

import { versionApprovalTrail } from '../../../src/app/features/admin/file-versions'

describe('versionApprovalTrail', () => {
  it('orders copies oldest to current so the change history is readable', () => {
    expect(
      versionApprovalTrail([
        { version: 2, current: true },
        { version: 1, current: false },
      ]),
    ).toBe('v1 → v2 (current)')
  })
})
