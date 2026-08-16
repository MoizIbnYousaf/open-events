import { useQuery } from '@tanstack/react-query'

import { listSpeakers } from '../api/admin-speakers'
import type { EventSlug } from '../../domain'

export const speakerQueryKeys = {
  roster: (slug: EventSlug) => ['admin', 'events', slug, 'speakers'] as const,
}

export function useSpeakerRoster(slug: EventSlug) {
  return useQuery({
    queryKey: speakerQueryKeys.roster(slug),
    queryFn: () => listSpeakers(slug),
  })
}
