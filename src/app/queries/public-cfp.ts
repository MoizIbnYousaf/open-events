import { useQuery } from '@tanstack/react-query'

import { getPublishedFormDefinition } from '../api/public'

export const publicCfpQueryKeys = {
  definition: (eventSlug: string, formSlug: string) =>
    ['public', 'cfp', eventSlug, formSlug] as const,
}

export function usePublishedCfp(eventSlug: string | undefined, formSlug: string | undefined) {
  return useQuery({
    queryKey: publicCfpQueryKeys.definition(eventSlug ?? '', formSlug ?? ''),
    queryFn: () => getPublishedFormDefinition(eventSlug as string, formSlug as string),
    enabled: eventSlug !== undefined && formSlug !== undefined,
  })
}
