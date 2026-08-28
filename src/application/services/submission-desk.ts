import type { EventId } from '../../domain'
import type { OrganizerActor } from '../actors'
import type {
  SubmissionDeskChoiceField,
  SubmissionDeskDto,
  SubmissionDeskFacetCount,
  SubmissionDeskQuery,
  SubmissionFacetSelection,
  SubmissionFacetDto,
  SubmissionFacetOptionDto,
} from '../dtos/submission-desk.dto'
import { SUBMISSION_DESK_PAGE_SIZE } from '../dtos/submission-desk.dto'
import type { SubmissionDeskRepository } from '../ports/submission-desk-repository'

interface PreparedFacet {
  readonly dto: SubmissionFacetDto
  readonly values: ReadonlySet<string>
}

function countOptions(
  definition: SubmissionDeskChoiceField,
  observed: ReadonlyMap<string, number>,
): readonly SubmissionFacetOptionDto[] {
  const counts = new Map(definition.options.map((value) => [value, observed.get(value) ?? 0]))
  for (const [value, count] of observed) counts.set(value, count)
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
  fields: readonly SubmissionDeskChoiceField[],
  counts: readonly SubmissionDeskFacetCount[],
): readonly PreparedFacet[] {
  const byElement = new Map<string, SubmissionDeskChoiceField>()
  for (const field of fields) {
    if (!byElement.has(field.elementId)) byElement.set(field.elementId, field)
  }
  const countsByElement = new Map<string, Map<string, number>>()
  for (const count of counts) {
    const values = countsByElement.get(count.elementId) ?? new Map<string, number>()
    values.set(count.value, count.count)
    countsByElement.set(count.elementId, values)
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
      const options = countOptions(
        definition,
        countsByElement.get(definition.elementId) ?? new Map(),
      )
      if (options.length === 0) return []
      return [
        {
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

function invalidFacetSelections(
  selected: readonly SubmissionFacetSelection[],
  facets: ReadonlyMap<string, PreparedFacet>,
): readonly SubmissionFacetSelection[] {
  return selected.filter((selection) => {
    const facet = facets.get(selection.elementId)
    return (
      facet === undefined ||
      selection.values.length === 0 ||
      selection.values.some((value) => !facet.values.has(value))
    )
  })
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
    const source = await this.#repository.listByEvent(eventId, query)
    const prepared = prepareFacets(source.choiceFields, source.facetCounts)
    const byId = new Map(prepared.map((facet) => [facet.dto.elementId, facet]))
    const invalid = invalidFacetSelections(query.facets, byId)
    const valid = invalid.length === 0
    return {
      rows: valid ? source.records.map((record) => record.item) : [],
      total: source.total,
      matchingTotal: valid ? source.matchingTotal : 0,
      page: valid ? source.page : 1,
      pageSize: SUBMISSION_DESK_PAGE_SIZE,
      pageCount: valid ? source.pageCount : 0,
      invalidFacetSelections: invalid,
      routingOptions: source.routingOptions,
      facetCounts: prepared.map((facet) => facet.dto),
    }
  }
}
