import type { EventId } from '../../domain'
import type {
  ProgrammeTimelineCategory,
  ProgrammeTimelineItemDto,
} from '../dtos/programme-timeline.dto'

export interface ProgrammeTimelineSource {
  readonly items: readonly ProgrammeTimelineItemDto[]
  readonly truncatedCategories: readonly ProgrammeTimelineCategory[]
}

export interface ProgrammeTimelineRepository {
  listLatest(eventId: EventId): Promise<ProgrammeTimelineSource>
}
