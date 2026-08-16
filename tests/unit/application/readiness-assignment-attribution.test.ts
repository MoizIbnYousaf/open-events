import { describe, expect, it } from 'vitest'

import { attributeAssignmentReadiness } from '../../../src/application/services/readiness-assignment-attribution'

describe('event-wide assignment readiness attribution', () => {
  it('attributes work to a proposal when the speaker has one accepted proposal', () => {
    const result = attributeAssignmentReadiness(
      [{ submissionId: 'proposal-a', contributorIds: ['speaker-1'] }],
      [{ assignees: [{ contactId: 'speaker-1', status: 'pending' }] }],
    )

    expect(result.event).toEqual({ total: 1, completed: 0 })
    expect(result.bySubmission.get('proposal-a')).toEqual({ total: 1, completed: 0 })
  })

  it('counts shared-speaker work once without guessing which proposal owns it', () => {
    const result = attributeAssignmentReadiness(
      [
        { submissionId: 'proposal-a', contributorIds: ['speaker-1'] },
        { submissionId: 'proposal-b', contributorIds: ['speaker-1'] },
      ],
      [{ assignees: [{ contactId: 'speaker-1', status: 'completed' }] }],
    )

    expect(result.event).toEqual({ total: 1, completed: 1 })
    expect(result.bySubmission.size).toBe(0)
  })

  it('ignores assignments for people outside the accepted programme', () => {
    const result = attributeAssignmentReadiness(
      [{ submissionId: 'proposal-a', contributorIds: ['speaker-1'] }],
      [{ assignees: [{ contactId: 'speaker-2', status: 'pending' }] }],
    )

    expect(result.event).toEqual({ total: 0, completed: 0 })
    expect(result.bySubmission.size).toBe(0)
  })
})
