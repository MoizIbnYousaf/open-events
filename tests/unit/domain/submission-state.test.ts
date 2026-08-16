import { describe, expect, it } from 'vitest'

import {
  CONTACT_ROLES,
  SUBMISSION_STATUSES,
  type ProposalDraft,
  type ProposalSubmission,
} from '../../../src/domain'
import { createDraft, createSubmission } from '../helpers/fixtures'

describe('submission state vocabulary', () => {
  it('keeps pending as the only M2 submission status', () => {
    expect(SUBMISSION_STATUSES).toEqual(['pending'])
  })

  it('defines primary and co-speaker contributor roles', () => {
    expect(CONTACT_ROLES).toEqual(['primary', 'co-speaker'])
  })

  it('keeps drafts distinct from submissions', () => {
    const draft: ProposalDraft = createDraft()
    const submission: ProposalSubmission = createSubmission({ originDraftId: draft.id })

    expect(draft).not.toHaveProperty('status')
    expect(draft).not.toHaveProperty('contentHash')
    expect(draft).not.toHaveProperty('routing')
    expect(draft).not.toHaveProperty('submittedAt')
    expect(submission.originDraftId).toBe(draft.id)
    expect(submission.status).toBe('pending')
  })

  it('binds idempotency to the unique originDraftId of the draft', () => {
    const draft = createDraft()
    const first = createSubmission({ id: 'submission-1', originDraftId: draft.id })
    const retry = createSubmission({ id: 'submission-2', originDraftId: draft.id })

    expect(first.originDraftId).toBe(retry.originDraftId)
    expect(first.id).not.toBe(retry.id)
  })
})
