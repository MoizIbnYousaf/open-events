import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { PortalResource, PortalResourceInput } from '../../domain'
import { requestJson } from '../api/admin-events'

export const adminResourceQueryKey = (eventSlug: string) =>
  ['admin', 'events', eventSlug, 'resources'] as const

export function useAdminResources(eventSlug: string) {
  return useQuery({
    queryKey: adminResourceQueryKey(eventSlug),
    queryFn: () =>
      requestJson<readonly PortalResource[]>(
        `/api/admin/events/${encodeURIComponent(eventSlug)}/resources`,
      ),
  })
}

export function useSaveAdminResource(eventSlug: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      readonly id: string | null
      readonly input: PortalResourceInput & { readonly published: boolean }
    }) =>
      requestJson<PortalResource>(
        id === null
          ? `/api/admin/events/${encodeURIComponent(eventSlug)}/resources`
          : `/api/admin/events/${encodeURIComponent(eventSlug)}/resources/${encodeURIComponent(id)}`,
        { method: id === null ? 'POST' : 'PATCH', body: JSON.stringify(input) },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: adminResourceQueryKey(eventSlug) }),
  })
}

export function useDeleteAdminResource(eventSlug: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<{ readonly deleted: true }>(
        `/api/admin/events/${encodeURIComponent(eventSlug)}/resources/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: adminResourceQueryKey(eventSlug) }),
  })
}

export function useReorderAdminResources(eventSlug: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: readonly string[]) =>
      requestJson<readonly PortalResource[]>(
        `/api/admin/events/${encodeURIComponent(eventSlug)}/resources/reorder`,
        { method: 'POST', body: JSON.stringify({ ids }) },
      ),
    onSuccess: (resources) => client.setQueryData(adminResourceQueryKey(eventSlug), resources),
  })
}
