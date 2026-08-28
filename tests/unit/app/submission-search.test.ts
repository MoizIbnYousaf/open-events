import { describe, expect, it } from 'vitest'

import {
  APP_SEARCH_PARAM_KEYS,
  RESERVED_SEARCH_PARAM_KEYS,
} from '../../../src/app/lib/search-param-keys'
import {
  DEFAULT_SUBMISSION_SEARCH,
  submissionSearchSchema,
  toSubmissionDeskQuery,
} from '../../../src/app/features/admin/submission-search'

describe('submission route search state', () => {
  it('normalizes malformed values without losing valid nested answer facets', () => {
    const parsed = submissionSearchSchema.parse({
      q: '  applied ai  ',
      decision: 'not-a-decision',
      routing: 'ai',
      sort: 'not-a-sort',
      page: -3,
      facets: [
        { elementId: 'element-format-v1', values: ['talk', 'talk'] },
        { elementId: 'element-topics-v1', values: ['agents'] },
      ],
      spotlight: 'submission-2',
      tour: '1',
    })

    expect(parsed).toEqual({
      q: 'applied ai',
      decision: 'all',
      routing: 'ai',
      sort: 'submitted-desc',
      page: 1,
      facets: [
        { elementId: 'element-format-v1', values: ['talk'] },
        { elementId: 'element-topics-v1', values: ['agents'] },
      ],
      spotlight: 'submission-2',
      tour: '1',
    })
    expect(toSubmissionDeskQuery(parsed)).toEqual({
      q: 'applied ai',
      decision: 'all',
      routing: 'ai',
      sort: 'submitted-desc',
      page: 1,
      facets: parsed.facets,
    })
  })

  it('falls back to a compact stable default and caps untrusted facet state', () => {
    const oversized = Array.from({ length: 20 }, (_, index) => ({
      elementId: `element-${index}`,
      values: Array.from({ length: 30 }, (__, value) => `value-${value}`),
    }))
    expect(submissionSearchSchema.parse({ facets: oversized })).toEqual(DEFAULT_SUBMISSION_SEARCH)
  })

  it('gives every app-level search feature a unique key', () => {
    const registered = Object.values(APP_SEARCH_PARAM_KEYS).flatMap((group) => Object.values(group))
    expect(registered).toHaveLength(RESERVED_SEARCH_PARAM_KEYS.size)
    expect(APP_SEARCH_PARAM_KEYS.submissions.facets).not.toBe(
      APP_SEARCH_PARAM_KEYS.submissions.spotlight,
    )
  })
})
