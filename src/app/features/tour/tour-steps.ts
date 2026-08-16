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
  /** Session shape the destination expects while the tour is narrating it. */
  readonly access: 'organizer' | 'public' | 'portal' | 'evaluation'
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
const showcaseFormId = 'f0000000-0000-4000-8000-000000000001'
const showcaseSubmissionId = 'd0000000-0000-4000-8000-000000000807'

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
    body: 'Open Events runs a conference programme end to end: the call for papers, evaluation, agenda building, and the public schedule. The tour opens a temporary DemoConf workspace so you can see every role without setup.',
    access: 'organizer',
  },
  {
    id: 'admin-signin',
    title: 'Organizer workspace',
    body: 'A normal organizer signs in before reaching this workspace. The tour has already opened a short-lived sandbox session, so the next steps can show the complete organizer flow with synthetic data.',
    route: '/admin',
    target: 'admin-signin',
    access: 'organizer',
  },
  {
    id: 'event-settings',
    title: 'Event settings',
    body: 'The event workspace opens on the event itself: name, timezone, dates, and status. Every other organizer screen hangs off this rail.',
    route: '/admin/events/$slug',
    params: eventParams,
    target: 'rail-event-settings',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'events',
    title: 'Event workspace',
    body: 'Return to the organizer event list from this rail, then open the conference workspace you want to manage.',
    route: '/admin/events/$slug',
    params: eventParams,
    target: 'rail-events',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'taxonomies',
    title: 'Taxonomies',
    body: 'Tracks, rooms, and session formats live here as data the rest of the app reuses. Define them once and the CFP, evaluations, and agenda all draw from the same lists.',
    route: '/admin/events/$slug/taxonomies',
    params: eventParams,
    target: 'rail-taxonomies',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'cfp-builder',
    title: 'CFP builder and versions',
    body: 'Build the questions speakers answer, preview the flow, and publish an immutable version. New edits become a fresh draft, so existing submissions keep the form they were answered against.',
    route: '/admin/events/$slug/forms/$formId',
    params: { slug: DEFAULT_EVENT_SLUG, formId: showcaseFormId },
    target: 'cfp-builder',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'submissions',
    title: 'Submissions',
    body: 'Every proposal the call for papers takes in lands in this list. Open one to review its answers, speakers, and materials.',
    route: '/admin/events/$slug/submissions',
    params: eventParams,
    target: 'rail-submissions',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'submission-workspace',
    title: 'Proposal review workspace',
    body: 'Open a proposal to read its frozen answers, edit programme copy, inspect evaluations, decide its outcome, and send the speaker through onboarding.',
    route: '/admin/events/$slug/submissions/$submissionId',
    params: { slug: DEFAULT_EVENT_SLUG, submissionId: showcaseSubmissionId },
    target: 'submission-workspace',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'speakers',
    title: 'Speakers desk',
    body: 'Manage the people behind accepted sessions here: profiles, contact details, portal access, and onboarding progress stay connected to the programme.',
    route: '/admin/events/$slug/speakers',
    params: eventParams,
    target: 'rail-speakers',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'messages',
    title: 'Messages and invitations',
    body: 'Send and audit speaker communications here, including calendar invitations. The delivery history keeps every outreach attempt visible.',
    route: '/admin/events/$slug/messages',
    params: eventParams,
    target: 'rail-messages',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'evaluations',
    title: 'Evaluations',
    body: 'The committee rates submissions here, and the scores roll up per proposal. Evaluators get their own focused surface for working through the queue.',
    route: '/admin/events/$slug/evaluations',
    params: eventParams,
    target: 'rail-evaluations',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'agenda',
    title: 'Agenda',
    body: 'Accepted sessions are placed onto days, tracks, and rooms on this board. What you arrange here becomes the public schedule.',
    route: '/admin/events/$slug/agenda',
    params: eventParams,
    target: 'rail-agenda',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'embeds',
    title: 'Embeds',
    body: 'Publish programme blocks into another site without rebuilding them. Embeds keep the external view tied to the event data here.',
    route: '/admin/events/$slug/embeds',
    params: eventParams,
    target: 'rail-embeds',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'files',
    title: 'Event files',
    body: 'Review uploaded headshots and session materials in one place, with their ownership and event context intact.',
    route: '/admin/events/$slug/files',
    params: eventParams,
    target: 'rail-files',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'orby',
    title: 'Orby assistant',
    body: 'Ask event-scoped questions and get answers grounded in the programme data, without leaving the organizer workspace.',
    route: '/admin/events/$slug/orby',
    params: eventParams,
    target: 'rail-orby',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'readiness',
    title: 'Readiness',
    body: 'A single checklist of what each accepted speaker still owes: profile, headshot, materials. It tells you who to chase before the event.',
    route: '/admin/events/$slug/readiness',
    params: eventParams,
    target: 'rail-readiness',
    requiresSession: 'organizer',
    access: 'organizer',
  },
  {
    id: 'palette',
    title: 'Command menu',
    body: 'Every destination the visible navigation offers is also one keystroke away: press Cmd or Ctrl+K, or use this button. It only ever lists screens you could also reach by looking.',
    target: 'palette-trigger',
    access: 'organizer',
  },
  {
    id: 'public-cfp',
    title: 'Call for papers',
    body: 'This is the public form speakers fill in to propose a talk. It renders the published form definition the organizer built, step by step.',
    route: '/cfp/$eventSlug/$formSlug',
    params: { eventSlug: DEFAULT_EVENT_SLUG, formSlug: DEFAULT_FORM_SLUG },
    target: 'cfp-page',
    access: 'public',
  },
  {
    id: 'start',
    title: 'Speaker start',
    body: 'Prospective speakers request a single-use CFP link here. Speaker portal and reviewer access use separate organizer-issued links, and a successful submission moves the primary speaker into the portal.',
    route: '/start',
    target: 'start-page',
    access: 'public',
  },
  {
    id: 'speaker-portal',
    title: 'Speaker portal',
    body: 'Accepted speakers use this private workspace to finish their profile, upload a headshot and materials, and complete the tasks the organizer assigned.',
    route: '/portal',
    target: 'speaker-portal',
    access: 'portal',
  },
  {
    id: 'reviewer-queue',
    title: 'Reviewer queue',
    body: 'Reviewers get a focused queue of assigned proposals. They can score each criterion, save notes, and recuse themselves when there is a conflict.',
    route: '/evaluations',
    target: 'reviewer-queue',
    access: 'evaluation',
  },
  {
    id: 'session-catalogue',
    title: 'Session catalogue',
    body: 'Attendees can browse and search every published session outside the timetable view, then open the details that matter to them.',
    route: '/sessions/$eventSlug',
    params: { eventSlug: DEFAULT_EVENT_SLUG },
    access: 'public',
  },
  {
    id: 'speaker-gallery',
    title: 'Speaker gallery',
    body: 'The public speaker directory connects each presenter to their published profile and sessions.',
    route: '/speakers/$eventSlug',
    params: { eventSlug: DEFAULT_EVENT_SLUG },
    access: 'public',
  },
  {
    id: 'schedule',
    title: 'Public schedule',
    body: 'The agenda the organizer built, published for attendees by list, track, and room. This closes the loop: from proposal to a session people can find.',
    route: '/schedule/$eventSlug',
    params: { eventSlug: DEFAULT_EVENT_SLUG },
    target: 'schedule-page',
    access: 'public',
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
