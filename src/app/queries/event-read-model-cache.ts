import type { QueryClient, QueryKey } from '@tanstack/react-query'

import type { EventSlug } from '../../domain'

export type EventReadModelChange =
  | 'verdict'
  | 'communication'
  | 'review-assignment'
  | 'review-invite'
  | 'agenda'
  | 'direct-session'
  | 'onboarding'

/** Canonical prefixes for every event-wide read model affected by lifecycle writes. */
export const eventReadModelQueryKeys = {
  submissions: (slug: EventSlug) => ['admin', 'events', slug, 'submissions'] as const,
  submissionDesk: (slug: EventSlug) => ['admin', 'events', slug, 'submission-desk'] as const,
  speakers: (slug: EventSlug) => ['admin', 'events', slug, 'speakers'] as const,
  messages: (slug: EventSlug) => ['admin', 'events', slug, 'messages'] as const,
  readiness: (slug: EventSlug) => ['admin', 'events', slug, 'readiness'] as const,
  agenda: (slug: EventSlug) => ['admin', 'events', slug, 'agenda'] as const,
  timeline: (slug: EventSlug) => ['admin', 'events', slug, 'programme-timeline'] as const,
  publicSchedule: (slug: EventSlug) => ['public', 'schedule', slug] as const,
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
    case 'review-invite':
      return [timeline, eventReadModelQueryKeys.messages(slug)]
    case 'agenda':
      return [
        timeline,
        eventReadModelQueryKeys.agenda(slug),
        eventReadModelQueryKeys.publicSchedule(slug),
      ]
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

function isCachedAdminEventReadModel(queryKey: QueryKey, models: ReadonlySet<string>): boolean {
  return (
    queryKey[0] === 'admin' &&
    queryKey[1] === 'events' &&
    typeof queryKey[2] === 'string' &&
    typeof queryKey[3] === 'string' &&
    models.has(queryKey[3])
  )
}

const PROGRAMME_TIMELINE_MODELS = new Set(['programme-timeline'])
const ONBOARDING_MODELS = new Set(['programme-timeline', 'speakers', 'readiness'])

/** Refreshes any organizer timeline already visited in this browser session. */
export async function invalidateCachedProgrammeTimelines(client: QueryClient): Promise<void> {
  await client.invalidateQueries({
    predicate: (query) => isCachedAdminEventReadModel(query.queryKey, PROGRAMME_TIMELINE_MODELS),
  })
}

/** Public task writes have no slug, so invalidate only cached onboarding projections. */
export async function invalidateCachedOnboardingReadModels(client: QueryClient): Promise<void> {
  await client.invalidateQueries({
    predicate: (query) => isCachedAdminEventReadModel(query.queryKey, ONBOARDING_MODELS),
  })
}
