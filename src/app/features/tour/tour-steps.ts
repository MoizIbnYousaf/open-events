import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'

/**
 * The product tour, as data.
 *
 * Pure TypeScript on purpose — no JSX, no router import — so the step list is
 * unit testable and the overlay component stays the only place that renders
 * anything. `target` names a `[data-tour="<id>"]` hook that the owning surface
 * declares; a step with no target (or whose target is absent, e.g. an
 * organizer page showing its signed-out state) renders centered instead.
 */
export interface TourStep {
  readonly id: string
  readonly title: string
  readonly body: string
  /** A TanStack route path literal, exactly as declared by the route tree. */
  readonly route?: string
  readonly params?: Readonly<Record<string, string>>
  /** A [data-tour] hook id; omitted for centered steps. */
  readonly target?: string
}

const eventParams = { slug: DEFAULT_EVENT_SLUG } as const

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to SpeakerOps',
    body: 'SpeakerOps runs a conference programme end to end: the call for papers, evaluation, agenda building, and the public schedule. This tour walks the whole loop in a few steps.',
  },
  {
    id: 'admin-signin',
    title: 'Organizer sign-in',
    body: 'Organizers sign in here with your organizer secret. Everything under the admin surface is scoped to a signed-in session.',
    route: '/admin',
    target: 'admin-signin',
  },
  {
    id: 'event-settings',
    title: 'Event settings',
    body: 'The event workspace opens on the event itself: name, timezone, dates, and status. Every other organizer screen hangs off this rail.',
    route: '/admin/events/$slug',
    params: eventParams,
    target: 'rail-event-settings',
  },
  {
    id: 'taxonomies',
    title: 'Taxonomies',
    body: 'Tracks, rooms, and session formats live here as data the rest of the app reuses. Define them once and the CFP, evaluations, and agenda all draw from the same lists.',
    route: '/admin/events/$slug/taxonomies',
    params: eventParams,
    target: 'rail-taxonomies',
  },
  {
    id: 'submissions',
    title: 'Submissions',
    body: 'Every proposal the call for papers takes in lands in this list. Open one to review its answers, speakers, and materials.',
    route: '/admin/events/$slug/submissions',
    params: eventParams,
    target: 'rail-submissions',
  },
  {
    id: 'evaluations',
    title: 'Evaluations',
    body: 'The committee rates submissions here, and the scores roll up per proposal. Evaluators get their own focused surface for working through the queue.',
    route: '/admin/events/$slug/evaluations',
    params: eventParams,
    target: 'rail-evaluations',
  },
  {
    id: 'agenda',
    title: 'Agenda',
    body: 'Accepted sessions are placed onto days, tracks, and rooms on this board. What you arrange here becomes the public schedule.',
    route: '/admin/events/$slug/agenda',
    params: eventParams,
    target: 'rail-agenda',
  },
  {
    id: 'readiness',
    title: 'Readiness',
    body: 'A single checklist of what each accepted speaker still owes: profile, headshot, materials. It tells you who to chase before the event.',
    route: '/admin/events/$slug/readiness',
    params: eventParams,
    target: 'rail-readiness',
  },
  {
    id: 'palette',
    title: 'Command menu',
    body: 'Every destination the visible navigation offers is also one keystroke away: press Cmd or Ctrl+K, or use this button. It only ever lists screens you could also reach by looking.',
    target: 'palette-trigger',
  },
  {
    id: 'public-cfp',
    title: 'Call for papers',
    body: 'This is the public form speakers fill in to propose a talk. It renders the published form definition the organizer built, step by step.',
    route: '/cfp/$eventSlug/$formSlug',
    params: { eventSlug: DEFAULT_EVENT_SLUG, formSlug: DEFAULT_FORM_SLUG },
    target: 'cfp-page',
  },
  {
    id: 'start',
    title: 'Speaker start',
    body: 'Speakers request a magic link here with just their email — no password to invent. The link signs them into their own portal.',
    route: '/start',
    target: 'start-page',
  },
  {
    id: 'schedule',
    title: 'Public schedule',
    body: 'The agenda the organizer built, published for attendees by list, track, and room. This closes the loop: from proposal to a session people can find.',
    route: '/schedule/$eventSlug',
    params: { eventSlug: DEFAULT_EVENT_SLUG },
    target: 'schedule-page',
  },
]
