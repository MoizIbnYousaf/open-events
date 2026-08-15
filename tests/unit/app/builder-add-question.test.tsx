import { describe, expect, it } from 'vitest'

import { addQuestionToDraft, type BuilderDraft } from '../../../src/app/features/builder/builder-model'

const DRAFT: BuilderDraft = {
  meta: {
    formId: 'form-1',
    eventId: 'event-1',
    versionId: 'version-1',
    version: 1,
    status: 'draft',
    contentHash: null,
    publishedAt: null,
    updatedAt: '2026-08-14T12:00:00.000Z',
  },
  content: {
    pages: [
      {
        id: 'page-1',
        eventId: 'event-1',
        versionId: 'version-1',
        position: 0,
        kind: 'info',
        title: 'Proposal',
        content: '',
      },
    ],
    elements: [],
    conditionRules: [],
    routingRules: [],
  },
}

describe('addQuestionToDraft', () => {
  it('appends a short-text question the organizer can then label', () => {
    const next = addQuestionToDraft(DRAFT, 'page-1', 'short_text')
    expect(next.content.elements).toHaveLength(1)
    const added = next.content.elements[0]
    expect(added?.label).toBe('New question')
    expect(added?.questionType).toBe('short_text')
    expect(added?.fieldKey).toBe('custom_question_1')
    expect(added?.pageId).toBe('page-1')
  })

  it('gives a dropdown a starter option list', () => {
    const next = addQuestionToDraft(DRAFT, 'page-1', 'single_choice')
    expect(next.content.elements[0]?.options).toEqual(['Option 1'])
  })
})
