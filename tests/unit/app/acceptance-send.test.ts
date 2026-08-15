import { describe, expect, it } from 'vitest'

import { acceptanceSendComplete } from '../../../src/app/features/admin/acceptance-send'
import { queriesInvalidatedOnVerdict } from '../../../src/app/queries/verdict-invalidation'

describe('acceptanceSendComplete', () => {
  it('stays open while the preview says not every recipient has been sent', () => {
    expect(acceptanceSendComplete({ alreadySent: false })).toBe(false)
  })

  it('locks the send only when every recipient has a stored row', () => {
    expect(acceptanceSendComplete({ alreadySent: true })).toBe(true)
  })
})

describe('queriesInvalidatedOnVerdict', () => {
  it('refetches the submissions list as well as the preview', () => {
    const keys = queriesInvalidatedOnVerdict('demo-conf-2026', 'sub-1')
    expect(keys).toContainEqual(['admin', 'events', 'demo-conf-2026', 'submissions'])
    expect(keys).toContainEqual(['admin', 'submissions', 'sub-1', 'acceptance-preview'])
  })
})
