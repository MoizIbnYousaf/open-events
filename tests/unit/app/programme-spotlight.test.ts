import { describe, expect, it, vi } from 'vitest'

import {
  nextSpotlightId,
  parseSpotlightSearch,
  preserveDeskLinkNavigation,
  shouldIgnoreSpotlightKey,
  writeSpotlightSearch,
} from '../../../src/app/features/admin/programme-spotlight'

describe('programme-spotlight', () => {
  it('reads and writes a deep-linkable spotlight search param', () => {
    expect(parseSpotlightSearch('?q=talk&spotlight=sub-2')).toBe('sub-2')
    expect(writeSpotlightSearch('?q=talk', 'sub-2')).toBe('?q=talk&spotlight=sub-2')
    expect(writeSpotlightSearch('?spotlight=sub-2', null)).toBe('')
  })

  it('moves j/k along the ordered desk ids and stops at the ends', () => {
    const ids = ['a', 'b', 'c']
    expect(nextSpotlightId(ids, null, 1)).toBe('a')
    expect(nextSpotlightId(ids, 'a', 1)).toBe('b')
    expect(nextSpotlightId(ids, 'c', 1)).toBe('c')
    expect(nextSpotlightId(ids, 'b', -1)).toBe('a')
    expect(nextSpotlightId(ids, 'a', -1)).toBe('a')
  })

  it('stops a title-link click from selecting the row instead of navigating', () => {
    const event = { stopPropagation: vi.fn() }
    preserveDeskLinkNavigation(event)
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('ignores keystrokes that belong to a field', () => {
    const input = document.createElement('input')
    expect(shouldIgnoreSpotlightKey(input)).toBe(true)
    expect(shouldIgnoreSpotlightKey(document.createElement('div'))).toBe(false)
  })
})
