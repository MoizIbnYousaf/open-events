/**
 * Search-param ownership for features that can share an application URL.
 *
 * Keeping the vocabulary in one place prevents an organizer filter, a guided
 * tour marker, and the list spotlight from silently parsing the same key in
 * incompatible ways.
 */
export const APP_SEARCH_PARAM_KEYS = {
  global: {
    access: 'access',
    tour: 'tour',
  },
  submissions: {
    query: 'q',
    decision: 'decision',
    routing: 'routing',
    sort: 'sort',
    facets: 'facets',
    page: 'page',
    view: 'view',
    spotlight: 'spotlight',
  },
  timeline: {
    category: 'category',
  },
} as const

export const RESERVED_SEARCH_PARAM_KEYS: ReadonlySet<string> = new Set(
  Object.values(APP_SEARCH_PARAM_KEYS).flatMap((group) => Object.values(group)),
)
