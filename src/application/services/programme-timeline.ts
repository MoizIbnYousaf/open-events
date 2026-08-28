import type { EventId } from '../../domain'
import type { OrganizerActor } from '../actors'
import {
  PROGRAMME_TIMELINE_LIMIT,
  type ProgrammeTimelineDto,
  type ProgrammeTimelineFilter,
  type ProgrammeTimelineItemDto,
} from '../dtos/programme-timeline.dto'
import type { ProgrammeTimelineRepository } from '../ports/programme-timeline-repository'

function latestById(
  items: readonly ProgrammeTimelineItemDto[],
): readonly ProgrammeTimelineItemDto[] {
  const latest = new Map<string, ProgrammeTimelineItemDto>()
  for (const item of items) {
    const current = latest.get(item.id)
    if (current === undefined || item.occurredAt > current.occurredAt) latest.set(item.id, item)
  }
  return [...latest.values()]
}

function newestFirst(
  items: readonly ProgrammeTimelineItemDto[],
): readonly ProgrammeTimelineItemDto[] {
  return items.toSorted(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id, 'en'),
  )
}

export class ProgrammeTimelineService {
  readonly #repository: ProgrammeTimelineRepository

  constructor(repository: ProgrammeTimelineRepository) {
    this.#repository = repository
  }

  async list(
    _actor: OrganizerActor,
    eventId: EventId,
    category: ProgrammeTimelineFilter,
  ): Promise<ProgrammeTimelineDto> {
    const source = await this.#repository.listLatest(eventId)
    const filtered = latestById(source.items).filter(
      (item) => category === 'all' || item.category === category,
    )
    const ordered = newestFirst(filtered)
    const sourceTruncated =
      category === 'all'
        ? source.truncatedCategories.length > 0
        : source.truncatedCategories.includes(category)
    return {
      category,
      items: ordered.slice(0, PROGRAMME_TIMELINE_LIMIT),
      limit: PROGRAMME_TIMELINE_LIMIT,
      truncated: sourceTruncated || ordered.length > PROGRAMME_TIMELINE_LIMIT,
    }
  }
}
