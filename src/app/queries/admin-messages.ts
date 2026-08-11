import { useQuery } from '@tanstack/react-query'

import { listMessages } from '../api/admin-messages'
import type { EventSlug } from '../../domain'

export const messageQueryKeys = {
  log: (slug: EventSlug) => ['admin', 'events', slug, 'messages'] as const,
}

export function useMessageLog(slug: EventSlug) {
  return useQuery({
    queryKey: messageQueryKeys.log(slug),
    queryFn: () => listMessages(slug),
    // An organizer watching for a message that has just been sent should not
    // have to reload the page to see it arrive.
    refetchInterval: 15_000,
  })
}
