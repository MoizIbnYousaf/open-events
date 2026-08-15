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
      id: 'events',
      label: 'Events',
      to: '/admin/events',
      group: 'Event',
    },
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
      // The people, beside the proposals. An organizer who could see every
      // submission and no speaker had to assemble the programme's cast by eye.
      id: 'speakers',
      label: 'Speakers',
      to: '/admin/events/$slug/speakers',
      params,
      group: 'Programme',
    },
    {
      // What the event has actually said, and to whom. Every message was
      // recorded from the day the product could write one and shown to nobody.
      id: 'messages',
      label: 'Messages',
      to: '/admin/events/$slug/messages',
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
    /* "Review committee", not "Evaluations": the page this opens is titled
       Review committee, and the product also has a SEPARATE speaker-facing
       /evaluations surface. One word for two destinations made the rail
       contradict the page it opened. */
    {
      id: 'evaluations',
      label: 'Review committee',
      to: '/admin/events/$slug/evaluations',
      params,
      group: 'Programme',
    },
    { id: 'agenda', label: 'Agenda', to: '/admin/events/$slug/agenda', params, group: 'Programme' },
    {
      id: 'embeds',
      label: 'Embeds',
      to: '/admin/events/$slug/embeds',
      params,
      group: 'Programme',
    },
    {
      id: 'files',
      label: 'Files',
      to: '/admin/events/$slug/files',
      params,
      group: 'Programme',
    },
    {
      id: 'orby',
      label: 'Orby',
      to: '/admin/events/$slug/orby',
      params,
      group: 'Programme',
    },
  ]
}

export function speakerDestinations(): readonly NavDestination[] {
  return [
    { id: 'portal', label: 'Your speaker portal', to: '/portal', group: 'Speaker' },
    { id: 'headshot', label: 'Your headshot', to: '/headshot', group: 'Speaker' },
    // The review queue was linked from nowhere. A committee member signed in,
    // landed on the speaker portal, and could reach the work they had been
    // assigned only by typing the URL — so to everyone not reading the source,
    // reviewing did not exist. It sits with the other signed-in destinations
    // because a reviewer IS a speaker-session identity; the page itself tells
    // anyone with no assignments that they have none.
    { id: 'reviews', label: 'Your reviews', to: '/evaluations', group: 'Speaker' },
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
    {
      id: 'public-sessions',
      label: 'Sessions',
      to: '/sessions/$eventSlug',
      params: { eventSlug },
      group: 'Public',
    },
    {
      id: 'public-speakers',
      label: 'Public speakers',
      to: '/speakers/$eventSlug',
      params: { eventSlug },
      group: 'Public',
    },
    {
      id: 'public-gallery',
      label: 'Speaker gallery',
      to: '/speakers/$eventSlug',
      params: { eventSlug },
      group: 'Public',
    },
  ]
}
