/**
 * The destinations this app can navigate to, as data.
 *
 * Six of the sixteen routes previously had no inbound link at all and were
 * reachable only by typing a URL — the organizer's submissions list, the
 * agenda, the public CFP, the public schedule, the evaluator surface and the
 * organizer sign-in. This module is the single source of truth so a new route
 * cannot go dark unnoticed, and so any future accelerator (a palette, a search)
 * can only ever offer destinations the visible navigation already exposes.
 *
 * Pure TypeScript on purpose: no JSX and no router import, so it stays unit
 * testable and reusable.
 */

export type NavGroup = 'Event' | 'Programme' | 'Public' | 'Speaker'

export interface NavDestination {
  readonly id: string
  readonly label: string
  /** A TanStack route path literal, exactly as declared by the route tree. */
  readonly to: string
  readonly params?: Readonly<Record<string, string>>
  readonly group: NavGroup
}

export function organizerDestinations(slug: string): readonly NavDestination[] {
  const params = { slug }
  return [
    {
      id: 'event-settings',
      label: 'Event settings',
      to: '/admin/events/$slug',
      params,
      group: 'Event',
    },
    {
      id: 'taxonomies',
      label: 'Taxonomies',
      to: '/admin/events/$slug/taxonomies',
      params,
      group: 'Event',
    },
    {
      id: 'submissions',
      label: 'Submissions',
      to: '/admin/events/$slug/submissions',
      params,
      group: 'Programme',
    },
    {
      id: 'readiness',
      label: 'Readiness',
      to: '/admin/events/$slug/readiness',
      params,
      group: 'Programme',
    },
    {
      id: 'evaluations',
      label: 'Evaluations',
      to: '/admin/events/$slug/evaluations',
      params,
      group: 'Programme',
    },
    { id: 'agenda', label: 'Agenda', to: '/admin/events/$slug/agenda', params, group: 'Programme' },
  ]
}

export function speakerDestinations(): readonly NavDestination[] {
  return [
    { id: 'portal', label: 'Your speaker portal', to: '/portal', group: 'Speaker' },
    { id: 'headshot', label: 'Your headshot', to: '/headshot', group: 'Speaker' },
  ]
}

export function publicDestinations(eventSlug: string, formSlug: string): readonly NavDestination[] {
  return [
    {
      id: 'public-cfp',
      label: 'Call for papers',
      to: '/cfp/$eventSlug/$formSlug',
      params: { eventSlug, formSlug },
      group: 'Public',
    },
    {
      id: 'public-schedule',
      label: 'Public schedule',
      to: '/schedule/$eventSlug',
      params: { eventSlug },
      group: 'Public',
    },
  ]
}
