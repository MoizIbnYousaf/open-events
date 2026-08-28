import type { AnswerValue, EventId } from '../../domain'
import type { OrganizerActor } from '../actors'
import type {
  SubmissionDeskChoiceField,
  SubmissionDeskDto,
  SubmissionDeskQuery,
  SubmissionDeskRecord,
  SubmissionFacetSelection,
  SubmissionFacetDto,
  SubmissionFacetOptionDto,
} from '../dtos/submission-desk.dto'
import { SUBMISSION_DESK_PAGE_SIZE } from '../dtos/submission-desk.dto'
import type { SubmissionDeskRepository } from '../ports/submission-desk-repository'

interface PreparedFacet {
  readonly definition: SubmissionDeskChoiceField
  readonly dto: SubmissionFacetDto
  readonly values: ReadonlySet<string>
}

function facetKey(elementId: string): string {
  return elementId
}

function answerValues(value: AnswerValue | null | undefined): readonly string[] {
  if (typeof value === 'string') return value === '' ? [] : [value]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item !== '')
}

function countOptions(
  records: readonly SubmissionDeskRecord[],
  definition: SubmissionDeskChoiceField,
): readonly SubmissionFacetOptionDto[] {
  const counts = new Map(definition.options.map((value) => [value, 0]))
  for (const record of records) {
    if (record.formVersionId !== definition.versionId) continue
    for (const value of new Set(answerValues(record.answers[definition.fieldKey]))) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  const knownOrder = new Map(definition.options.map((value, index) => [value, index]))
  return [...counts.entries()]
    .sort(
      ([left], [right]) =>
        (knownOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (knownOrder.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right, 'en'),
    )
    .map(([value, count]) => ({ value, count }))
}

function prepareFacets(
  records: readonly SubmissionDeskRecord[],
  fields: readonly SubmissionDeskChoiceField[],
): readonly PreparedFacet[] {
  const byElement = new Map<string, SubmissionDeskChoiceField>()
  for (const field of fields) {
    if (!byElement.has(field.elementId)) byElement.set(field.elementId, field)
  }

  return [...byElement.values()]
    .sort(
      (left, right) =>
        left.formSlug.localeCompare(right.formSlug, 'en') ||
        left.version - right.version ||
        left.position - right.position ||
        left.fieldKey.localeCompare(right.fieldKey, 'en'),
    )
    .flatMap((definition): readonly PreparedFacet[] => {
      const options = countOptions(records, definition)
      if (options.length === 0) return []
      return [
        {
          definition,
          dto: {
            elementId: definition.elementId,
            versionId: definition.versionId,
            formId: definition.formId,
            formSlug: definition.formSlug,
            fieldKey: definition.fieldKey,
            label: definition.label,
            questionType: definition.questionType,
            options,
          },
          values: new Set(options.map((option) => option.value)),
        },
      ]
    })
}

function decisionRank(value: SubmissionDeskRecord['item']['decision']): number {
  return value === 'accepted' ? 0 : value === 'pending' ? 1 : 2
}

function matchesQuery(record: SubmissionDeskRecord, query: SubmissionDeskQuery): boolean {
  const needle = query.q.trim().toLocaleLowerCase()
  const matchesText =
    needle === '' ||
    record.item.title.toLocaleLowerCase().includes(needle) ||
    record.item.primarySpeaker.name.toLocaleLowerCase().includes(needle) ||
    record.item.primarySpeaker.email.toLocaleLowerCase().includes(needle)
  return (
    matchesText &&
    (query.decision === 'all' || record.item.decision === query.decision) &&
    (query.routing === 'all' || record.item.routing?.actionTarget === query.routing)
  )
}

function matchesFacets(
  record: SubmissionDeskRecord,
  selected: readonly SubmissionFacetSelection[],
  facets: ReadonlyMap<string, PreparedFacet>,
): boolean {
  for (const requested of selected) {
    const facet = facets.get(facetKey(requested.elementId))
    if (facet === undefined || record.formVersionId !== facet.definition.versionId) return false
    const valid = requested.values.filter((value) => facet.values.has(value))
    if (valid.length !== requested.values.length || valid.length === 0) return false
    const actual = new Set(answerValues(record.answers[facet.definition.fieldKey]))
    if (!valid.some((value) => actual.has(value))) return false
  }
  return true
}

function invalidFacetSelections(
  selected: readonly SubmissionFacetSelection[],
  facets: ReadonlyMap<string, PreparedFacet>,
): readonly SubmissionFacetSelection[] {
  return selected.filter((selection) => {
    const facet = facets.get(facetKey(selection.elementId))
    return (
      facet === undefined ||
      selection.values.length === 0 ||
      selection.values.some((value) => !facet.values.has(value))
    )
  })
}

function sortRecords(
  records: readonly SubmissionDeskRecord[],
  sort: SubmissionDeskQuery['sort'],
): readonly SubmissionDeskRecord[] {
  return records.toSorted((left, right) => {
    const stable = left.item.id.localeCompare(right.item.id)
    switch (sort) {
      case 'submitted-asc':
        return left.item.submittedAt.localeCompare(right.item.submittedAt) || stable
      case 'title-asc':
        return left.item.title.localeCompare(right.item.title, 'en') || stable
      case 'decision-asc':
        return decisionRank(left.item.decision) - decisionRank(right.item.decision) || stable
      case 'submitted-desc':
        return right.item.submittedAt.localeCompare(left.item.submittedAt) || stable
    }
  })
}

function routingOptions(
  records: readonly SubmissionDeskRecord[],
): readonly SubmissionFacetOptionDto[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    const value = record.item.routing?.actionTarget
    if (value === undefined || value === null || value === '') continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([value, count]) => ({ value, count }))
}

export class SubmissionDeskService {
  readonly #repository: SubmissionDeskRepository

  constructor(repository: SubmissionDeskRepository) {
    this.#repository = repository
  }

  async list(
    _actor: OrganizerActor,
    eventId: EventId,
    query: SubmissionDeskQuery,
  ): Promise<SubmissionDeskDto> {
    const source = await this.#repository.listByEvent(eventId)
    const prepared = prepareFacets(source.records, source.choiceFields)
    const byId = new Map(prepared.map((facet) => [facetKey(facet.dto.elementId), facet]))
    const invalid = invalidFacetSelections(query.facets, byId)
    const matching =
      invalid.length > 0
        ? []
        : sortRecords(
            source.records.filter(
              (record) => matchesQuery(record, query) && matchesFacets(record, query.facets, byId),
            ),
            query.sort,
          )
    const pageCount = Math.ceil(matching.length / SUBMISSION_DESK_PAGE_SIZE)
    const resolvedPage = pageCount === 0 ? 1 : Math.min(query.page, pageCount)
    const pageStart = (resolvedPage - 1) * SUBMISSION_DESK_PAGE_SIZE
    const rows = matching.slice(pageStart, pageStart + SUBMISSION_DESK_PAGE_SIZE)
    return {
      rows: rows.map((record) => record.item),
      total: source.total,
      matchingTotal: matching.length,
      page: resolvedPage,
      pageSize: SUBMISSION_DESK_PAGE_SIZE,
      pageCount,
      truncated: source.truncated,
      invalidFacetSelections: invalid,
      routingOptions: routingOptions(source.records),
      facetCounts: prepared.map((facet) => facet.dto),
    }
  }
}
