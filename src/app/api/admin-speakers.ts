import type { SpeakerRosterEntryDto } from '../../application'
import type { EventSlug } from '../../domain'

import { requestJson } from './admin-events'

/** GET /api/admin/events/:slug/speakers — everyone on the programme. */
export function listSpeakers(slug: EventSlug): Promise<readonly SpeakerRosterEntryDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/speakers`)
}
