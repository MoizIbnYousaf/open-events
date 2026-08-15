import { describe, expect, it } from 'vitest'

import {
  latestApprovedSnapshot,
  publicSessionCopy,
  sessionHasApprovedSnapshot,
  shouldSnapshotApprovedCopy,
} from '../../../src/domain/session-content'

describe('publicSessionCopy', () => {
  it('serves the live title when the session is approved', () => {
    expect(
      publicSessionCopy({
        contentStatus: 'approved',
        liveTitle: 'New title',
        liveAbstract: 'New abstract',
        lastApproved: { title: 'Old title', abstract: 'Old abstract' },
      }),
    ).toEqual({ visible: true, title: 'New title', abstract: 'New abstract' })
  })

  it('keeps the last approved copy live while an edit is draft', () => {
    expect(
      publicSessionCopy({
        contentStatus: 'draft',
        liveTitle: 'Pending title',
        liveAbstract: 'Pending abstract',
        lastApproved: { title: 'Live title', abstract: 'Live abstract' },
      }),
    ).toEqual({ visible: true, title: 'Live title', abstract: 'Live abstract' })
  })

  it('hides a draft that has never been approved', () => {
    expect(
      publicSessionCopy({
        contentStatus: 'draft',
        liveTitle: 'Pending',
        liveAbstract: '',
        lastApproved: null,
      }),
    ).toEqual({ visible: false, title: '', abstract: '' })
  })
})

describe('sessionHasApprovedSnapshot', () => {
  it('is true once a last-approved snapshot exists', () => {
    expect(sessionHasApprovedSnapshot('draft', { title: 'Kept', abstract: '' })).toBe(true)
    expect(sessionHasApprovedSnapshot('draft', null)).toBe(false)
  })
})

describe('approved snapshot rules', () => {
  it('snapshots only when leaving an approved row', () => {
    expect(shouldSnapshotApprovedCopy('approved')).toBe(true)
    expect(shouldSnapshotApprovedCopy('draft')).toBe(false)
  })

  it('reads the last stored snapshot as the approved copy', () => {
    expect(
      latestApprovedSnapshot([
        { title: 'A', abstract: 'a' },
        { title: 'B', abstract: 'b' },
      ]),
    ).toEqual({ title: 'B', abstract: 'b' })
    expect(latestApprovedSnapshot([])).toBeNull()
  })
})
