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
  /**
   * Set on steps whose surface only exists for a signed-in organizer. The tour
   * owns no session model and probes nothing: the mark simply tells the overlay
   * that this step's `target` is *evidence*, not decoration. An organizer route
   * renders its rail (and therefore its `rail-*` hook) only after the session
   * check passes — every denied, expired or errored branch returns a state card
   * instead — so "the hook never appeared" is the same fact as "this visitor is
   * not seeing the organizer surface", read off the DOM the tour already polls.
   */
  readonly requiresSession?: 'organizer'
}

const eventParams = { slug: DEFAULT_EVENT_SLUG } as const

/**
 * What the tour says instead of narrating an organizer screen that never
 * rendered. It names the reason, offers the door back to the one screen that
 * can fix it, and offers the way on for a visitor who has no secret to type.
 *
 * It used to promise the tour "picks up right here" after signing in. It does
 * not: the tour holds on this step until the reader presses Next, and a
 * promise the product does not keep is worse than a plain instruction. The
 * replacement is shorter than what it replaces, which matters — this string is
 * entry-chunk data.
 */
export const TOUR_ORGANIZER_HOLD = {
  title: 'Sign in to continue the tour',
  body: 'These screens only render for a signed-in session. Sign in with the organizer secret, then press Next — or skip ahead to the screens anyone can see.',
} as const

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Open Events',
    body: 'Open Events runs a conference programme end to end: the call for papers, evaluation, agenda building, and the public schedule. This tour walks the whole loop in a few steps. The organizer half needs a signed-in session; the next step is where you get one.',
  },
  {
    id: 'admin-signin',
    title: 'Organizer sign-in',
    body: 'Organizers sign in here with the organizer secret. Everything under the admin surface is scoped to that session — sign in now and the tour follows you through it, or skip ahead to the public screens.',
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
    requiresSession: 'organizer',
  },
  {
    id: 'taxonomies',
    title: 'Taxonomies',
    body: 'Tracks, rooms, and session formats live here as data the rest of the app reuses. Define them once and the CFP, evaluations, and agenda all draw from the same lists.',
    route: '/admin/events/$slug/taxonomies',
    params: eventParams,
    target: 'rail-taxonomies',
    requiresSession: 'organizer',
  },
  {
    id: 'submissions',
    title: 'Submissions',
    body: 'Every proposal the call for papers takes in lands in this list. Open one to review its answers, speakers, and materials.',
    route: '/admin/events/$slug/submissions',
    params: eventParams,
    target: 'rail-submissions',
    requiresSession: 'organizer',
  },
  {
    id: 'evaluations',
    title: 'Evaluations',
    body: 'The committee rates submissions here, and the scores roll up per proposal. Evaluators get their own focused surface for working through the queue.',
    route: '/admin/events/$slug/evaluations',
    params: eventParams,
    target: 'rail-evaluations',
    requiresSession: 'organizer',
  },
  {
    id: 'agenda',
    title: 'Agenda',
    body: 'Accepted sessions are placed onto days, tracks, and rooms on this board. What you arrange here becomes the public schedule.',
    route: '/admin/events/$slug/agenda',
    params: eventParams,
    target: 'rail-agenda',
    requiresSession: 'organizer',
  },
  {
    id: 'readiness',
    title: 'Readiness',
    body: 'A single checklist of what each accepted speaker still owes: profile, headshot, materials. It tells you who to chase before the event.',
    route: '/admin/events/$slug/readiness',
    params: eventParams,
    target: 'rail-readiness',
    requiresSession: 'organizer',
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

/**
 * The organizer door: where a held step sends anyone who wants to fix the hold
 * rather than route around it. Derived rather than hard-coded so reordering the
 * list cannot silently point the recovery at the wrong screen.
 */
export const TOUR_SIGN_IN_STEP_INDEX = TOUR_STEPS.findIndex((step) => step.id === 'admin-signin')

/**
 * Where a held tour resumes: the first later step that is BOTH ungated and
 * route-bearing. Route-bearing matters as much as ungated — a step with no
 * route inherits whatever page is already on screen, and for a tour held on a
 * denied organizer route that page is the denied one, which is exactly what the
 * hold exists to stop narrating over. Returns -1 when no such step is left.
 */
export function publicResumeIndexAfter(index: number): number {
  return TOUR_STEPS.findIndex(
    (step, at) => at > index && step.requiresSession === undefined && step.route !== undefined,
  )
}
