import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import {
  adminLogin,
  getEventConfig,
  getTaxonomies,
  listForms,
  replaceTaxonomies,
  updateEventConfig,
  updateFormWindow,
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
  return useServerMutation({ mutationFn: (secret: string) => adminLogin(secret) })
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
  return useServerMutation({
    mutationFn: (input: UpdateEventConfigInput) => updateEventConfig(slug, input),
    onSuccess: (updated: AdminEventConfigDto) => {
      queryClient.setQueryData(adminQueryKeys.config(slug), updated)
    },
  })
}

export function useUpdateFormWindow(slug: EventSlug, formId: string) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (input: { readonly opensAt: string | null; readonly closesAt: string | null }) =>
      updateFormWindow(slug, formId, input),
    onSuccess: () => {
      // The public definition's submissionState is derived from these dates, so
      // the forms list is refetched rather than patched from the response.
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.forms(slug) })
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
  return useServerMutation({
    mutationFn: (items: readonly TaxonomyItemInput[]) => replaceTaxonomies(slug, items),
    onSuccess: (updated: TaxonomyListDto) => {
      queryClient.setQueryData(adminQueryKeys.taxonomies(slug), updated)
    },
  })
}
