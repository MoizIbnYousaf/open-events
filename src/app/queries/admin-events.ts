import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  adminLogin,
  getEventConfig,
  getTaxonomies,
  listForms,
  replaceTaxonomies,
  updateEventConfig,
} from '../api/admin-events'
import type {
  AdminEventConfigDto,
  TaxonomyItemInput,
  TaxonomyListDto,
  UpdateEventConfigInput,
} from '../../application'
import type { EventSlug } from '../../domain'

export const adminQueryKeys = {
  config: (slug: EventSlug) => ['admin', 'events', slug, 'config'] as const,
  taxonomies: (slug: EventSlug) => ['admin', 'events', slug, 'taxonomies'] as const,
  forms: (slug: EventSlug) => ['admin', 'events', slug, 'forms'] as const,
}

export function useAdminLogin() {
  return useMutation({ mutationFn: (secret: string) => adminLogin(secret) })
}

export function useEventConfig(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminQueryKeys.config(slug ?? ''),
    queryFn: () => getEventConfig(slug as EventSlug),
    enabled: slug !== undefined,
  })
}

export function useUpdateEventConfig(slug: EventSlug) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateEventConfigInput) => updateEventConfig(slug, input),
    onSuccess: (updated: AdminEventConfigDto) => {
      queryClient.setQueryData(adminQueryKeys.config(slug), updated)
    },
  })
}

export function useTaxonomies(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminQueryKeys.taxonomies(slug ?? ''),
    queryFn: () => getTaxonomies(slug as EventSlug),
    enabled: slug !== undefined,
  })
}

/** Form discovery rows for the admin builder entry list. */
export function useFormsList(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminQueryKeys.forms(slug ?? ''),
    queryFn: () => listForms(slug as EventSlug),
    enabled: slug !== undefined,
  })
}

export function useReplaceTaxonomies(slug: EventSlug) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (items: readonly TaxonomyItemInput[]) => replaceTaxonomies(slug, items),
    onSuccess: (updated: TaxonomyListDto) => {
      queryClient.setQueryData(adminQueryKeys.taxonomies(slug), updated)
    },
  })
}
