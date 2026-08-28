import type { QueryClient, QueryKey } from '@tanstack/react-query'

import type { EventSlug } from '../../domain'

export type EventReadModelChange =
  'verdict' | 'communication' | 'review-assignment' | 'agenda' | 'direct-session' | 'onboarding'

/** Canonical prefixes for every event-wide read model affected by lifecycle writes. */
export const eventReadModelQueryKeys = {
  submissions: (slug: EventSlug) => ['admin', 'events', slug, 'submissions'] as const,
  submissionDesk: (slug: EventSlug) => ['admin', 'events', slug, 'submission-desk'] as const,
  speakers: (slug: EventSlug) => ['admin', 'events', slug, 'speakers'] as const,
  messages: (slug: EventSlug) => ['admin', 'events', slug, 'messages'] as const,
  readiness: (slug: EventSlug) => ['admin', 'events', slug, 'readiness'] as const,
  agenda: (slug: EventSlug) => ['admin', 'events', slug, 'agenda'] as const,
  timeline: (slug: EventSlug) => ['admin', 'events', slug, 'programme-timeline'] as const,
}

export function eventReadModelKeysFor(
  slug: EventSlug,
  change: EventReadModelChange,
): readonly QueryKey[] {
  const timeline = eventReadModelQueryKeys.timeline(slug)
  switch (change) {
    case 'verdict':
      return [
        timeline,
        eventReadModelQueryKeys.submissions(slug),
        eventReadModelQueryKeys.submissionDesk(slug),
        eventReadModelQueryKeys.speakers(slug),
        eventReadModelQueryKeys.readiness(slug),
        eventReadModelQueryKeys.agenda(slug),
      ]
    case 'communication':
      return [timeline, eventReadModelQueryKeys.messages(slug)]
    case 'review-assignment':
      return [timeline]
    case 'agenda':
      return [timeline, eventReadModelQueryKeys.agenda(slug)]
    case 'direct-session':
      return [
        timeline,
        eventReadModelQueryKeys.agenda(slug),
        eventReadModelQueryKeys.speakers(slug),
        eventReadModelQueryKeys.readiness(slug),
      ]
    case 'onboarding':
      return [
        timeline,
        eventReadModelQueryKeys.speakers(slug),
        eventReadModelQueryKeys.readiness(slug),
      ]
  }
}

export async function invalidateEventReadModels(
  client: QueryClient,
  slug: EventSlug,
  change: EventReadModelChange,
): Promise<void> {
  await Promise.all(
    eventReadModelKeysFor(slug, change).map((queryKey) => client.invalidateQueries({ queryKey })),
  )
}
