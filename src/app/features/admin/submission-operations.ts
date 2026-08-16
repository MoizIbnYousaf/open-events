import type { SubmissionListItemDto } from '../../../application'

export const SUBMISSION_DECISION_FILTERS = ['all', 'pending', 'accepted', 'rejected'] as const
export type SubmissionDecisionFilter = (typeof SUBMISSION_DECISION_FILTERS)[number]
export const SUBMISSION_SORTS = [
  'submitted-desc',
  'submitted-asc',
  'title-asc',
  'decision-asc',
] as const
export type SubmissionSort = (typeof SUBMISSION_SORTS)[number]

export interface SubmissionOperationsState {
  readonly decision: SubmissionDecisionFilter
  readonly routing: string
  readonly sort: SubmissionSort
}

export const DEFAULT_SUBMISSION_OPERATIONS: SubmissionOperationsState = {
  decision: 'all',
  routing: 'all',
  sort: 'submitted-desc',
}

function included<T extends readonly string[]>(
  values: T,
  value: string | null,
): value is T[number] {
  return value !== null && values.includes(value as T[number])
}

export function readSubmissionOperations(search: string): SubmissionOperationsState {
  const params = new URLSearchParams(search)
  const decision = params.get('decision')
  const sort = params.get('sort')
  const routing = params.get('routing')
  return {
    decision: included(SUBMISSION_DECISION_FILTERS, decision) ? decision : 'all',
    routing: routing === null || routing.trim() === '' ? 'all' : routing,
    sort: included(SUBMISSION_SORTS, sort) ? sort : 'submitted-desc',
  }
}

export function writeSubmissionOperations(
  search: string,
  state: SubmissionOperationsState,
): string {
  const params = new URLSearchParams(search)
  for (const [key, value, fallback] of [
    ['decision', state.decision, 'all'],
    ['routing', state.routing, 'all'],
    ['sort', state.sort, 'submitted-desc'],
  ] as const) {
    if (value === fallback) params.delete(key)
    else params.set(key, value)
  }
  const encoded = params.toString()
  return encoded === '' ? '' : `?${encoded}`
}

function decisionRank(value: SubmissionListItemDto['decision']): number {
  return value === 'accepted' ? 0 : value === 'pending' ? 1 : 2
}

export function operateOnSubmissions(
  rows: readonly SubmissionListItemDto[],
  term: string,
  state: SubmissionOperationsState,
): readonly SubmissionListItemDto[] {
  const needle = term.trim().toLocaleLowerCase()
  return rows
    .filter((row) => {
      const matchesTerm =
        needle === '' ||
        row.title.toLocaleLowerCase().includes(needle) ||
        row.primarySpeaker.name.toLocaleLowerCase().includes(needle) ||
        row.primarySpeaker.email.toLocaleLowerCase().includes(needle)
      return (
        matchesTerm &&
        (state.decision === 'all' || row.decision === state.decision) &&
        (state.routing === 'all' || row.routing?.actionTarget === state.routing)
      )
    })
    .toSorted((left, right) => {
      const stable = left.id.localeCompare(right.id)
      switch (state.sort) {
        case 'submitted-asc':
          return left.submittedAt.localeCompare(right.submittedAt) || stable
        case 'title-asc':
          return left.title.localeCompare(right.title, 'en') || stable
        case 'decision-asc':
          return decisionRank(left.decision) - decisionRank(right.decision) || stable
        case 'submitted-desc':
          return right.submittedAt.localeCompare(left.submittedAt) || stable
      }
    })
}

function safeSpreadsheetCell(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${neutralized.replaceAll('"', '""')}"`
}

export function submissionsCsv(rows: readonly SubmissionListItemDto[]): string {
  const headings = [
    'Title',
    'Primary speaker',
    'Email',
    'Co-speakers',
    'Form',
    'Version',
    'Routing',
    'Decision',
    'Submitted',
  ]
  const body = rows.map((row) =>
    [
      row.title,
      row.primarySpeaker.name,
      row.primarySpeaker.email,
      String(row.coSpeakerCount),
      row.formSlug,
      String(row.version),
      row.routing?.actionTarget ?? '',
      row.decision,
      row.submittedAt,
    ]
      .map(safeSpreadsheetCell)
      .join(','),
  )
  return `\uFEFF${headings.map(safeSpreadsheetCell).join(',')}\r\n${body.join('\r\n')}\r\n`
}
