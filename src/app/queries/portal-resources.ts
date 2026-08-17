import { useQuery } from '@tanstack/react-query'

import type { PortalResource } from '../../domain'
import { requestJson } from '../api/admin-events'

export const portalResourceQueryKey = ['portal', 'resources'] as const

export function usePortalResources() {
  return useQuery({
    queryKey: portalResourceQueryKey,
    queryFn: () => requestJson<readonly PortalResource[]>('/api/public/resources'),
    retry: false,
  })
}
