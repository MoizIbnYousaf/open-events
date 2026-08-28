import { describe, expect, it, vi } from 'vitest'

import type {
  SubmissionDeskChoiceField,
  SubmissionDeskRecord,
  SubmissionDeskRepository,
} from '../../../src/application/ports/submission-desk-repository'
import type { SubmissionDeskSource } from '../../../src/application/dtos/submission-desk.dto'
import { SubmissionDeskService } from '../../../src/application/services/submission-desk'
import { organizerActor } from '../helpers/fixtures'

const EVENT_ID = 'event-1'

function record(id: string, title: string): SubmissionDeskRecord {
  return {
    item: {
      id,
      title,
      status: 'pending',
      source: 'cfp',
      formId: 'form-1',
      formSlug: 'cfp',
      version: 1,
      routing: { actionKind: 'assign_track', actionTarget: 'ai' },
      primarySpeaker: {
        contactId: `contact-${id}`,
        name: `Speaker ${id}`,
        email: `${id}@example.test`,
        role: 'primary',
        position: 0,
      },
      coSpeakerCount: 0,
      decision: 'pending',
      createdAt: '2026-08-08T12:00:00.000Z',
      submittedAt: '2026-08-08T12:00:00.000Z',
    },
  }
}

const FIELDS: readonly SubmissionDeskChoiceField[] = [
  {
    elementId: 'element-format-v1',
    formId: 'form-1',
    versionId: 'version-1',
    formSlug: 'cfp',
    fieldKey: 'format',
    label: 'Session format',
    questionType: 'single_choice',
    version: 1,
    position: 1,
    options: ['talk', 'workshop'],
  },
  {
    elementId: 'element-topics-v1',
    formId: 'form-1',
    versionId: 'version-1',
    formSlug: 'cfp',
    fieldKey: 'topics',
    label: 'Topics',
    questionType: 'multi_choice',
    version: 1,
    position: 2,
    options: ['agents', 'safety', 'testing'],
  },
]

const SOURCE: SubmissionDeskSource = {
  records: [record('c', 'AI testing'), record('a', 'Applied AI')],
  choiceFields: FIELDS,
  facetCounts: [
    { elementId: 'element-format-v1', value: 'talk', count: 2 },
    { elementId: 'element-format-v1', value: 'workshop', count: 1 },
    { elementId: 'element-topics-v1', value: 'agents', count: 1 },
    { elementId: 'element-topics-v1', value: 'safety', count: 2 },
    { elementId: 'element-topics-v1', value: 'testing', count: 1 },
  ],
  routingOptions: [
    { value: 'ai', count: 2 },
    { value: 'platform', count: 1 },
  ],
  total: 3,
  matchingTotal: 2,
  page: 1,
  pageCount: 1,
}

function repository(source: SubmissionDeskSource = SOURCE): SubmissionDeskRepository {
  return { listByEvent: vi.fn(async () => source) }
}

const QUERY = {
  q: 'ai',
  decision: 'all' as const,
  routing: 'ai',
  sort: 'title-asc' as const,
  page: 1,
  facets: [
    { elementId: 'element-format-v1', values: ['talk'] },
    { elementId: 'element-topics-v1', values: ['agents', 'testing'] },
  ],
}

describe('SubmissionDeskService', () => {
  it('returns repository paging with canonical answer facets and exact totals', async () => {
    const repo = repository()
    const result = await new SubmissionDeskService(repo).list(organizerActor, EVENT_ID, QUERY)

    expect(repo.listByEvent).toHaveBeenCalledWith(EVENT_ID, QUERY)
    expect(result).toMatchObject({
      total: 3,
      matchingTotal: 2,
      page: 1,
      pageSize: 50,
      pageCount: 1,
      invalidFacetSelections: [],
      routingOptions: SOURCE.routingOptions,
    })
    expect(result.rows.map((row) => row.id)).toEqual(['c', 'a'])
    expect(result.facetCounts).toEqual([
      expect.objectContaining({
        elementId: 'element-format-v1',
        options: [
          { value: 'talk', count: 2 },
          { value: 'workshop', count: 1 },
        ],
      }),
      expect.objectContaining({
        elementId: 'element-topics-v1',
        options: [
          { value: 'agents', count: 1 },
          { value: 'safety', count: 2 },
          { value: 'testing', count: 1 },
        ],
      }),
    ])
  })

  it('fails closed when a saved view names a removed facet or answer', async () => {
    const result = await new SubmissionDeskService(repository()).list(organizerActor, EVENT_ID, {
      ...QUERY,
      facets: [
        { elementId: 'element-removed', values: ['old-value'] },
        { elementId: 'element-format-v1', values: ['retired-format'] },
      ],
    })

    expect(result.rows).toEqual([])
    expect(result.matchingTotal).toBe(0)
    expect(result.page).toBe(1)
    expect(result.pageCount).toBe(0)
    expect(result.invalidFacetSelections).toEqual([
      { elementId: 'element-removed', values: ['old-value'] },
      { elementId: 'element-format-v1', values: ['retired-format'] },
    ])
  })

  it('preserves repository page normalization and a partial final page', async () => {
    const source = {
      ...SOURCE,
      records: [record('50', 'Proposal 50')],
      total: 51,
      matchingTotal: 51,
      page: 2,
      pageCount: 2,
    }
    const result = await new SubmissionDeskService(repository(source)).list(
      organizerActor,
      EVENT_ID,
      {
        ...QUERY,
        q: '',
        page: 9,
        facets: [],
      },
    )

    expect(result.rows.map((row) => row.id)).toEqual(['50'])
    expect(result.page).toBe(2)
    expect(result.pageCount).toBe(2)
    expect(result.matchingTotal).toBe(51)
  })
})
