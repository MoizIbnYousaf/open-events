import { useQuery } from '@tanstack/react-query'

import type { ProgrammeTimelineFilter } from '../../application/dtos/programme-timeline.dto'
import type { EventSlug } from '../../domain'
import { listProgrammeTimeline } from '../api/admin-programme-timeline'

export const programmeTimelineQueryKeys = {
  event: (slug: EventSlug) => ['admin', 'events', slug, 'programme-timeline'] as const,
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
