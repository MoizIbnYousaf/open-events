import { describe, expect, it, vi } from 'vitest'

import type {
  SubmissionDeskChoiceField,
  SubmissionDeskRecord,
  SubmissionDeskRepository,
} from '../../../src/application/ports/submission-desk-repository'
import { SubmissionDeskService } from '../../../src/application/services/submission-desk'
import { organizerActor } from '../helpers/fixtures'

const EVENT_ID = 'event-1'

function record(input: {
  readonly id: string
  readonly title: string
  readonly decision: 'pending' | 'accepted' | 'rejected'
  readonly submittedAt: string
  readonly routing?: string
  readonly format: string
  readonly topics: readonly string[]
}): SubmissionDeskRecord {
  return {
    item: {
      id: input.id,
      title: input.title,
      status: 'pending',
      source: 'cfp',
      formId: 'form-1',
      formSlug: 'cfp',
      version: 1,
      routing:
        input.routing === undefined
          ? null
          : { actionKind: 'assign_track', actionTarget: input.routing },
      primarySpeaker: {
        contactId: `contact-${input.id}`,
        name: `Speaker ${input.id}`,
        email: `${input.id}@example.test`,
        role: 'primary',
        position: 0,
      },
      coSpeakerCount: 0,
      decision: input.decision,
      createdAt: input.submittedAt,
      submittedAt: input.submittedAt,
    },
    formVersionId: 'version-1',
    answers: { format: input.format, topics: input.topics },
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

const RECORDS = [
  record({
    id: 'a',
    title: 'Applied AI',
    decision: 'accepted',
    submittedAt: '2026-08-08T12:00:00.000Z',
    routing: 'ai',
    format: 'talk',
    topics: ['agents', 'safety'],
  }),
  record({
    id: 'b',
    title: 'Reliable systems',
    decision: 'pending',
    submittedAt: '2026-08-09T12:00:00.000Z',
    routing: 'platform',
    format: 'workshop',
    topics: ['safety'],
  }),
  record({
    id: 'c',
    title: 'AI testing',
    decision: 'rejected',
    submittedAt: '2026-08-10T12:00:00.000Z',
    routing: 'ai',
    format: 'talk',
    topics: ['testing'],
  }),
]

function repository(records: readonly SubmissionDeskRecord[] = RECORDS): SubmissionDeskRepository {
  return {
    listByEvent: vi.fn(async () => ({
      records,
      choiceFields: FIELDS,
      total: records.length,
      truncated: false,
    })),
  }
}

describe('SubmissionDeskService', () => {
  it('returns one event-scoped read model with stable rows, totals, and bounded answer facets', async () => {
    const repo = repository()
    const service = new SubmissionDeskService(repo)

    const result = await service.list(organizerActor, EVENT_ID, {
      q: 'ai',
      decision: 'all',
      routing: 'ai',
      sort: 'title-asc',
      page: 1,
      facets: [
        { elementId: 'element-format-v1', values: ['talk'] },
        { elementId: 'element-topics-v1', values: ['agents', 'testing'] },
      ],
    })

    expect(repo.listByEvent).toHaveBeenCalledOnce()
    expect(repo.listByEvent).toHaveBeenCalledWith(EVENT_ID)
    expect(result.total).toBe(3)
    expect(result.matchingTotal).toBe(2)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(50)
    expect(result.pageCount).toBe(1)
    expect(result.truncated).toBe(false)
    expect(result.invalidFacetSelections).toEqual([])
    expect(result.rows.map((row) => row.id)).toEqual(['c', 'a'])
    expect(result.routingOptions).toEqual([
      { value: 'ai', count: 2 },
      { value: 'platform', count: 1 },
    ])
    expect(result.facetCounts).toEqual([
      {
        elementId: 'element-format-v1',
        versionId: 'version-1',
        formId: 'form-1',
        formSlug: 'cfp',
        fieldKey: 'format',
        label: 'Session format',
        questionType: 'single_choice',
        options: [
          { value: 'talk', count: 2 },
          { value: 'workshop', count: 1 },
        ],
      },
      {
        elementId: 'element-topics-v1',
        versionId: 'version-1',
        formId: 'form-1',
        formSlug: 'cfp',
        fieldKey: 'topics',
        label: 'Topics',
        questionType: 'multi_choice',
        options: [
          { value: 'agents', count: 1 },
          { value: 'safety', count: 2 },
          { value: 'testing', count: 1 },
        ],
      },
    ])
  })

  it('reports stale saved facet keys and values without silently widening the result', async () => {
    const service = new SubmissionDeskService(repository())

    const result = await service.list(organizerActor, EVENT_ID, {
      q: '',
      decision: 'all',
      routing: 'all',
      sort: 'submitted-desc',
      page: 1,
      facets: [
        { elementId: 'element-removed', values: ['old-value'] },
        { elementId: 'element-format-v1', values: ['retired-format'] },
      ],
    })

    expect(result.rows).toEqual([])
    expect(result.matchingTotal).toBe(0)
    expect(result.invalidFacetSelections).toEqual([
      { elementId: 'element-removed', values: ['old-value'] },
      { elementId: 'element-format-v1', values: ['retired-format'] },
    ])
  })

  it('matches every selected facet and any selected value within one facet', async () => {
    const service = new SubmissionDeskService(repository())

    const result = await service.list(organizerActor, EVENT_ID, {
      q: '',
      decision: 'all',
      routing: 'all',
      sort: 'submitted-desc',
      page: 1,
      facets: [
        { elementId: 'element-format-v1', values: ['talk'] },
        { elementId: 'element-topics-v1', values: ['agents', 'testing'] },
      ],
    })

    expect(result.rows.map((row) => row.id)).toEqual(['c', 'a'])
  })

  it('paginates the filtered result with deterministic totals', async () => {
    const records = Array.from({ length: 51 }, (_, index) =>
      record({
        id: String(index).padStart(2, '0'),
        title: `Proposal ${index}`,
        decision: 'pending',
        submittedAt: '2026-08-08T12:00:00.000Z',
        format: 'talk',
        topics: [],
      }),
    )
    const service = new SubmissionDeskService(repository(records))

    const result = await service.list(organizerActor, EVENT_ID, {
      q: '',
      decision: 'all',
      routing: 'all',
      sort: 'submitted-desc',
      page: 2,
      facets: [],
    })

    expect(result.rows.map((row) => row.id)).toEqual(['50'])
    expect(result.total).toBe(51)
    expect(result.matchingTotal).toBe(51)
    expect(result.pageSize).toBe(50)
    expect(result.pageCount).toBe(2)
  })

  it('normalizes a stale page to the last page that still exists', async () => {
    const service = new SubmissionDeskService(repository())

    const result = await service.list(organizerActor, EVENT_ID, {
      q: '',
      decision: 'all',
      routing: 'all',
      sort: 'submitted-desc',
      page: 9,
      facets: [],
    })

    expect(result.page).toBe(1)
    expect(result.rows.map((row) => row.id)).toEqual(['c', 'b', 'a'])
  })
})
