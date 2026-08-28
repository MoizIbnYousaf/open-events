import { useQuery } from '@tanstack/react-query'

import { getAgendaBoard } from '../api/admin-agenda'
import type { EventSlug } from '../../domain'
import { eventReadModelQueryKeys } from './event-read-model-cache'

export const adminAgendaQueryKeys = {
  board: eventReadModelQueryKeys.agenda,
}

export function useAgendaBoard(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminAgendaQueryKeys.board(slug ?? ''),
    queryFn: () => getAgendaBoard(slug as EventSlug),
    enabled: slug !== undefined,
  })
}
