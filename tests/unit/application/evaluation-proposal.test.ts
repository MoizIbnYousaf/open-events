import { describe, expect, it } from 'vitest'

import { proposalAnswersForReview } from '../../../src/application/evaluation-proposal'

describe('proposalAnswersForReview', () => {
  it('lifts the seeded CFP answers a reviewer needs', () => {
    expect(
      proposalAnswersForReview({
        abstract: 'A short abstract',
        track: 'Platform',
        takeaway: 'Ship smaller diffs',
      }),
    ).toEqual({
      abstract: 'A short abstract',
      track: 'Platform',
      takeaway: 'Ship smaller diffs',
    })
  })

  it('uses empty strings when a key is missing', () => {
    expect(proposalAnswersForReview({})).toEqual({ abstract: '', track: '', takeaway: '' })
  })

  it('reads the seeded key_takeaway field', () => {
    expect(proposalAnswersForReview({ key_takeaway: 'Ship smaller diffs' }).takeaway).toBe(
      'Ship smaller diffs',
    )
  })
})
