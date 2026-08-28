import type { AnswerMap, QuestionType } from '../../domain'
import type { SubmissionListItemDto } from './submission.dto'

export const SUBMISSION_DECISION_FILTERS = ['all', 'pending', 'accepted', 'rejected'] as const
export type SubmissionDecisionFilter = (typeof SUBMISSION_DECISION_FILTERS)[number]

export const SUBMISSION_SORTS = [
  'submitted-desc',
  'submitted-asc',
  'title-asc',
  'decision-asc',
] as const
export type SubmissionSort = (typeof SUBMISSION_SORTS)[number]

export const SUBMISSION_DESK_PAGE_SIZE = 50
export const SUBMISSION_DESK_SCAN_LIMIT = 1_000
export const MAX_SUBMISSION_QUERY_LENGTH = 200
export const MAX_SUBMISSION_FACETS = 12
export const MAX_SUBMISSION_FACET_VALUES = 20
export const MAX_SUBMISSION_SELECTED_VALUES = 64
export const MAX_SUBMISSION_FACET_TOKEN_LENGTH = 200

export interface SubmissionFacetSelection {
  readonly elementId: string
  readonly values: readonly string[]
}

export interface SubmissionDeskQuery {
  readonly q: string
  readonly decision: SubmissionDecisionFilter
  readonly routing: string
  readonly sort: SubmissionSort
  readonly page: number
  readonly facets: readonly SubmissionFacetSelection[]
}

export const DEFAULT_SUBMISSION_DESK_QUERY: SubmissionDeskQuery = {
  q: '',
  decision: 'all',
  routing: 'all',
  sort: 'submitted-desc',
  page: 1,
  facets: [],
}

export interface SubmissionFacetOptionDto {
  readonly value: string
  readonly count: number
}

export interface SubmissionFacetDto {
  readonly elementId: string
  readonly versionId: string
  readonly formId: string
  readonly formSlug: string
  readonly fieldKey: string
  readonly label: string
  readonly questionType: Extract<QuestionType, 'single_choice' | 'multi_choice'>
  readonly options: readonly SubmissionFacetOptionDto[]
}

export interface SubmissionDeskDto {
  readonly rows: readonly SubmissionListItemDto[]
  readonly total: number
  readonly matchingTotal: number
  readonly page: number
  readonly pageSize: number
  readonly pageCount: number
  readonly truncated: boolean
  readonly invalidFacetSelections: readonly SubmissionFacetSelection[]
  readonly routingOptions: readonly SubmissionFacetOptionDto[]
  readonly facetCounts: readonly SubmissionFacetDto[]
}

/** Fully hydrated organizer row plus the immutable answers it was submitted with. */
export interface SubmissionDeskRecord {
  readonly item: SubmissionListItemDto
  readonly formVersionId: string
  readonly answers: AnswerMap
}

/** One bounded-choice question from one immutable form version. */
export interface SubmissionDeskChoiceField {
  readonly elementId: string
  readonly formId: string
  readonly versionId: string
  readonly formSlug: string
  readonly fieldKey: string
  readonly label: string
  readonly questionType: Extract<QuestionType, 'single_choice' | 'multi_choice'>
  readonly version: number
  readonly position: number
  readonly options: readonly string[]
}

export interface SubmissionDeskSource {
  readonly records: readonly SubmissionDeskRecord[]
  readonly choiceFields: readonly SubmissionDeskChoiceField[]
  /** Exact number of CFP submissions in the event, including beyond the scan cap. */
  readonly total: number
  /** True when `records` stopped at `SUBMISSION_DESK_SCAN_LIMIT`. */
  readonly truncated: boolean
}
