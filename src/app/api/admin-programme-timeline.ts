import type {
  ProgrammeTimelineDto,
  ProgrammeTimelineFilter,
} from '../../application/dtos/programme-timeline.dto'
import type { EventSlug } from '../../domain'
import { requestJson } from './admin-events'

export function listProgrammeTimeline(
  slug: EventSlug,
  category: ProgrammeTimelineFilter,
): Promise<ProgrammeTimelineDto> {
  const query = category === 'all' ? '' : `?category=${encodeURIComponent(category)}`
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/timeline${query}`)
}
