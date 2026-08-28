import { useQuery } from '@tanstack/react-query'

import type { ProgrammeTimelineFilter } from '../../application/dtos/programme-timeline.dto'
import type { EventSlug } from '../../domain'
import { listProgrammeTimeline } from '../api/admin-programme-timeline'
import { eventReadModelQueryKeys } from './event-read-model-cache'

export const programmeTimelineQueryKeys = {
  event: eventReadModelQueryKeys.timeline,
  list: (slug: EventSlug, category: ProgrammeTimelineFilter) =>
    [...programmeTimelineQueryKeys.event(slug), category] as const,
}

export function useProgrammeTimeline(slug: EventSlug, category: ProgrammeTimelineFilter) {
  return useQuery({
    queryKey: programmeTimelineQueryKeys.list(slug, category),
    queryFn: () => listProgrammeTimeline(slug, category),
    refetchInterval: 30_000,
  })
}
