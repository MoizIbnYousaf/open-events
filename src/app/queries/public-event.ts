import { useQuery } from '@tanstack/react-query'

import { getEventBySlug } from '../api/events'

const DEMO_CONF_2026_SLUG = 'demo-conf-2026'

/** Shared cached query for the public landing event. */
export function useLandingEvent() {
  return useQuery({
    queryKey: ['public', 'event', DEMO_CONF_2026_SLUG],
    queryFn: ({ signal }) => getEventBySlug(DEMO_CONF_2026_SLUG, { signal }),
    retry: false,
  })
}
