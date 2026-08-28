import { useQuery } from '@tanstack/react-query'

import { listMessages } from '../api/admin-messages'
import type { EventSlug } from '../../domain'
import { eventReadModelQueryKeys } from './event-read-model-cache'

export const messageQueryKeys = {
  log: eventReadModelQueryKeys.messages,
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
