import {
  DEFAULT_SUBMISSION_DESK_QUERY,
  MAX_SUBMISSION_FACETS,
  MAX_SUBMISSION_FACET_TOKEN_LENGTH,
  MAX_SUBMISSION_FACET_VALUES,
  MAX_SUBMISSION_QUERY_LENGTH,
  MAX_SUBMISSION_SELECTED_VALUES,
  SUBMISSION_DECISION_FILTERS,
  SUBMISSION_SORTS,
  type SubmissionDeskQuery,
  type SubmissionFacetSelection,
} from '../../../application/dtos/submission-desk.dto'
import { APP_SEARCH_PARAM_KEYS } from '../../lib/search-param-keys'

const keys = APP_SEARCH_PARAM_KEYS.submissions

export interface SubmissionSearch extends SubmissionDeskQuery {
  readonly view?: string
  readonly spotlight?: string
  readonly tour?: '1'
}

export type SubmissionSearchInput = Partial<Omit<SubmissionSearch, 'tour'>> & {
  readonly tour?: '1' | 1 | true
}

function text(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized.length <= MAX_SUBMISSION_QUERY_LENGTH ? normalized : fallback
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized !== '' && normalized.length <= MAX_SUBMISSION_FACET_TOKEN_LENGTH
    ? normalized
    : undefined
}

function choice<T extends readonly string[]>(
  values: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && values.includes(value) ? (value as T[number]) : fallback
}

function parsePage(value: unknown): number {
  const candidate =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 1
  return Number.isInteger(candidate) && candidate >= 1 && candidate <= 10_000 ? candidate : 1
}

function facetSelections(value: unknown): SubmissionFacetSelection[] {
  if (!Array.isArray(value) || value.length > MAX_SUBMISSION_FACETS) return []
  const byElement = new Map<string, string[]>()
  let selectedValues = 0
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const record = candidate as { elementId?: unknown; values?: unknown }
    const elementId = optionalText(record.elementId)
    if (
      elementId === undefined ||
      !Array.isArray(record.values) ||
      record.values.length > MAX_SUBMISSION_FACET_VALUES
    ) {
      return []
    }
    const values: string[] = []
    for (const option of record.values) {
      const normalized = optionalText(option)
      if (normalized === undefined) return []
      values.push(normalized)
    }
    selectedValues += values.length
    if (selectedValues > MAX_SUBMISSION_SELECTED_VALUES) return []
    byElement.set(elementId, [...new Set([...(byElement.get(elementId) ?? []), ...values])].sort())
  }
  return [...byElement.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([elementId, values]) => ({ elementId, values }))
}

export function parseSubmissionSearch(value: unknown): SubmissionSearch {
  const raw = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const record = raw as Record<string, unknown>
  const view = optionalText(record[keys.view])
  const spotlight = optionalText(record[keys.spotlight])
  const rawTour = record[APP_SEARCH_PARAM_KEYS.global.tour]
  const tour = rawTour === '1' || rawTour === 1 || rawTour === true ? '1' : undefined
  return {
    q: text(record[keys.query], ''),
    decision: choice(SUBMISSION_DECISION_FILTERS, record[keys.decision], 'all'),
    routing: text(record[keys.routing], 'all') || 'all',
    sort: choice(SUBMISSION_SORTS, record[keys.sort], 'submitted-desc'),
    page: parsePage(record[keys.page]),
    facets: facetSelections(record[keys.facets]),
    ...(view === undefined ? {} : { view }),
    ...(spotlight === undefined ? {} : { spotlight }),
    ...(tour === undefined ? {} : { tour }),
  }
}

/** TanStack Router accepts any parser object; this keeps route metadata dependency-free. */
export const submissionSearchSchema = {
  types: {
    input: undefined as unknown as SubmissionSearchInput,
    output: undefined as unknown as SubmissionSearch,
  },
  parse: (value: unknown): SubmissionSearch => parseSubmissionSearch(value),
}

export const DEFAULT_SUBMISSION_SEARCH: SubmissionSearch = parseSubmissionSearch({})

export function toSubmissionDeskQuery(search: SubmissionSearch): SubmissionDeskQuery {
  return {
    q: search.q,
    decision: search.decision,
    routing: search.routing,
    sort: search.sort,
    page: search.page,
    facets: search.facets,
  }
}

export function defaultSubmissionDeskQuery(): SubmissionDeskQuery {
  return DEFAULT_SUBMISSION_DESK_QUERY
}

/** Omits validated defaults so links stay readable while retaining meaningful state. */
export function compactSubmissionSearch(search: SubmissionSearch): SubmissionSearchInput {
  return {
    ...(search.q === '' ? {} : { q: search.q }),
    ...(search.decision === 'all' ? {} : { decision: search.decision }),
    ...(search.routing === 'all' ? {} : { routing: search.routing }),
    ...(search.sort === 'submitted-desc' ? {} : { sort: search.sort }),
    ...(search.page === 1 ? {} : { page: search.page }),
    ...(search.facets.length === 0 ? {} : { facets: search.facets }),
    ...(search.view === undefined ? {} : { view: search.view }),
    ...(search.spotlight === undefined ? {} : { spotlight: search.spotlight }),
    ...(search.tour === undefined ? {} : { tour: search.tour }),
  }
}
