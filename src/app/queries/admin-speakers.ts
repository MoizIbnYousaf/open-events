import { useQuery } from '@tanstack/react-query'

import { listSpeakers } from '../api/admin-speakers'
import type { EventSlug } from '../../domain'
import { eventReadModelQueryKeys } from './event-read-model-cache'

export const speakerQueryKeys = {
  roster: eventReadModelQueryKeys.speakers,
}

export function useSpeakerRoster(slug: EventSlug) {
  return useQuery({
    queryKey: speakerQueryKeys.roster(slug),
    queryFn: () => listSpeakers(slug),
  })
}
