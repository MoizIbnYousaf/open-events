import { useQuery } from '@tanstack/react-query'

import { getAgendaBoard } from '../api/admin-agenda'
import type { EventSlug } from '../../domain'

export const adminAgendaQueryKeys = {
  board: (slug: EventSlug) => ['admin', 'events', slug, 'agenda'] as const,
}

export function useAgendaBoard(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminAgendaQueryKeys.board(slug ?? ''),
    queryFn: () => getAgendaBoard(slug as EventSlug),
    enabled: slug !== undefined,
  })
}
