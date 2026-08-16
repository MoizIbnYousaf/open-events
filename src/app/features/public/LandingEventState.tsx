import { Link } from '@tanstack/react-router'

import type { EventDto } from '../../../application/dtos/event-dto'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { buttonVariants } from '../../../components/ui/button-variants'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'
import { useLandingEvent } from '../../queries/public-event'
import { requestTourToggle } from '../tour/tour-events'
import SpeakerNav from './SpeakerNav'

const STAGES = [
  ['01', 'Collect', 'Publish a clear call for papers and keep every draft together.'],
  ['02', 'Review', 'Give reviewers focused queues, scoring rubrics, and clean handoffs.'],
  ['03', 'Onboard', 'Collect speaker details, files, headshots, and readiness in one place.'],
  ['04', 'Schedule', 'Build the programme, spot conflicts, and publish when it is ready.'],
] as const

const PERSONAS = [
  [
    'For organizers',
    'One operating desk',
    'Move from submissions to a published programme without stitching together forms, spreadsheets, and email threads.',
    '/admin',
    'Organizer sign-in',
  ],
  [
    'For speakers',
    'A calmer way to contribute',
    'Submit a proposal, complete onboarding, and keep every requested item in one private workspace.',
    '/start',
    'Get speaker access',
  ],
  [
    'For reviewers',
    'The next decision, clearly',
    'Review assigned proposals with consistent criteria, record a score, and move directly to the next one.',
    '/evaluations',
    'Open reviewer access',
  ],
] as const

function eventMeta(event: EventDto): string {
  if (event.startsAt === null) return event.name
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: event.timezone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const start = formatter.format(new Date(event.startsAt))
    const end = event.endsAt === null ? null : formatter.format(new Date(event.endsAt))
    return `${event.name} · ${end === null || end === start ? start : `${start} – ${end}`}`
  } catch {
    return event.name
  }
}

function LandingSkeleton() {
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 lg:px-10">
      <div
        aria-busy="true"
        aria-label="Loading event status"
        className="grid min-h-[64vh] gap-5 lg:grid-cols-2"
      >
        <div className="grid content-center gap-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-28 w-full max-w-xl" />
          <Skeleton className="h-12 w-full max-w-lg" />
          <Link to="/start" className="text-sm font-semibold text-link">
            Sign in
          </Link>
        </div>
        <Skeleton className="min-h-96 w-full rounded-2xl" />
      </div>
      <SpeakerNav />
    </div>
  )
}

export default function LandingEventState() {
  const eventQuery = useLandingEvent()
  if (eventQuery.isPending) return <LandingSkeleton />
  if (eventQuery.isError) {
    return (
      <section className="mx-auto grid min-h-[70vh] max-w-3xl content-center gap-5 px-5 py-20 text-center">
        <h1 className="font-heading text-4xl font-semibold tracking-[-0.04em]">
          Could not load DemoConf 2026
        </h1>
        <p role="alert" className="text-muted-foreground">
          We failed to load event details. Please try again.
        </p>
        <Button className="mx-auto" variant="outline" onClick={() => void eventQuery.refetch()}>
          Try again
        </Button>
        <Link to="/start" className="text-sm font-semibold text-link">
          Sign in
        </Link>
        <div className="mt-8 text-left">
          <SpeakerNav />
        </div>
      </section>
    )
  }
  const event = eventQuery.data
  if (event === null || event === undefined) {
    return (
      <section className="mx-auto grid min-h-[70vh] max-w-3xl content-center gap-5 px-5 py-20 text-center">
        <h1 className="font-heading text-4xl font-semibold tracking-[-0.04em]">Event not found</h1>
        <StatusLive>No event named DemoConf 2026 is configured yet.</StatusLive>
        <Link to="/start" className={buttonVariants({ className: 'mx-auto' })}>
          Sign in
        </Link>
        <div className="mt-8 text-left">
          <SpeakerNav />
        </div>
      </section>
    )
  }
  const demoMeta = eventMeta(event)

  return (
    <div className="overflow-hidden bg-background text-foreground">
      <section className="relative mx-auto grid min-h-[calc(100svh-4rem)] max-w-[1500px] lg:grid-cols-[0.92fr_1.08fr]">
        <div className="relative z-10 flex flex-col justify-center px-5 py-16 sm:px-10 lg:px-16 lg:py-24 xl:px-24">
          <p className="mb-7 text-xs font-semibold tracking-[0.18em] text-link uppercase">
            Open Events
          </p>
          <h1 className="max-w-3xl text-balance font-heading text-[3.25rem] leading-[0.94] font-semibold tracking-[-0.065em] sm:text-7xl xl:text-[6rem]">
            Your event, <br />
            finally in sync.
          </h1>
          <p className="mt-7 max-w-xl break-words text-pretty text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Run your call for papers, reviews, speaker onboarding, schedule, and public programme
            from one focused workspace.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button size="lg" onClick={requestTourToggle}>
              Take the tour
            </Button>
            <Link to="/start" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Get access
            </Link>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Link to="/start" className="text-sm font-semibold text-link">
              Sign in
            </Link>
            <Badge dot variant={event.status === 'published' ? 'secondary' : 'outline'}>
              {event.status === 'published'
                ? 'Published'
                : event.status === 'draft'
                  ? 'Draft'
                  : 'Archived'}
            </Badge>
          </div>
          <Link
            to="/schedule/$eventSlug"
            params={{ eventSlug: DEFAULT_EVENT_SLUG }}
            className="group mt-12 flex max-w-lg items-center justify-between border-t border-border pt-5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>
              <span className="block font-semibold text-foreground">Explore the live demo</span>
              <span className="mt-1 block text-muted-foreground">{demoMeta}</span>
            </span>
            <span
              className="text-xl text-link transition-transform group-hover:translate-x-1"
              aria-hidden="true"
            >
              →
            </span>
          </Link>
        </div>
        <div className="relative min-h-[54svh] overflow-hidden lg:min-h-full">
          <img
            src="/images/open-events-hero-v2.png"
            alt="An event director overlooking a prepared conference auditorium"
            className="absolute inset-0 h-full w-full object-cover object-left"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10 lg:bg-gradient-to-r lg:from-background/45 lg:via-transparent lg:to-transparent" />
          <div className="absolute right-5 bottom-5 left-5 flex items-end justify-between border-t border-white/30 pt-4 text-xs tracking-[0.08em] text-white/80 uppercase sm:right-10 sm:left-10">
            <span>From proposal to programme</span>
            <span>Built in the open</span>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/45">
        <div className="mx-auto grid max-w-7xl md:grid-cols-2 xl:grid-cols-4">
          {STAGES.map(([number, title, copy]) => (
            <article
              key={number}
              className="border-b border-border px-5 py-9 last:border-b-0 md:border-r md:px-8 md:last:border-r-0 xl:border-b-0"
            >
              <span className="text-xs font-semibold text-link">{number}</span>
              <h2 className="mt-8 font-heading text-2xl font-semibold tracking-[-0.035em]">
                {title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-10 lg:grid-cols-[0.8fr_1.2fr] lg:py-32">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-link uppercase">
            The whole programme
          </p>
          <h2 className="mt-5 max-w-xl text-balance font-heading text-4xl leading-[1.02] font-semibold tracking-[-0.05em] sm:text-6xl">
            Less chasing. More running the event.
          </h2>
        </div>
        <div className="grid content-start gap-8 lg:pt-9">
          <p className="max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
            Every role gets a workspace shaped around the job at hand. Organizers see the operation,
            speakers see their next request, and reviewers see the next proposal.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              to="/sessions/$eventSlug"
              params={{ eventSlug: DEFAULT_EVENT_SLUG }}
              className={buttonVariants({ variant: 'outline' })}
            >
              Browse sessions
            </Link>
            <Link
              to="/speakers/$eventSlug"
              params={{ eventSlug: DEFAULT_EVENT_SLUG }}
              className={buttonVariants({ variant: 'outline' })}
            >
              Meet speakers
            </Link>
            <Link
              to="/schedule/$eventSlug"
              params={{ eventSlug: DEFAULT_EVENT_SLUG }}
              className={buttonVariants({ variant: 'outline' })}
            >
              View schedule
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-border">
        <div className="mx-auto grid max-w-7xl lg:grid-cols-3">
          {PERSONAS.map(([label, title, copy, to, action]) => (
            <Link
              key={label}
              to={to}
              className="group flex min-h-80 flex-col border-b border-border px-5 py-10 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-10 lg:border-r lg:border-b-0 lg:last:border-r-0"
            >
              <span className="text-xs font-semibold tracking-[0.14em] text-link uppercase">
                {label}
              </span>
              <h2 className="mt-10 max-w-xs font-heading text-3xl leading-tight font-semibold tracking-[-0.04em]">
                {title}
              </h2>
              <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">{copy}</p>
              <span className="mt-auto pt-10 text-sm font-semibold text-foreground">
                {action}
                <span
                  className="ml-2 inline-block text-link transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                >
                  →
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-20 sm:px-10 lg:grid-cols-[1fr_auto] lg:items-end lg:py-28">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-link uppercase">
            Ready when you are
          </p>
          <h2 className="mt-4 max-w-4xl text-balance font-heading text-4xl leading-[1.03] font-semibold tracking-[-0.05em] sm:text-6xl">
            See the complete event lifecycle in under five minutes.
          </h2>
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          <Button size="lg" onClick={requestTourToggle}>
            Start the tour
          </Button>
          <Link
            to="/cfp/$eventSlug/$formSlug"
            params={{ eventSlug: DEFAULT_EVENT_SLUG, formSlug: DEFAULT_FORM_SLUG }}
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            Open the CFP
          </Link>
        </div>
      </section>

      <footer className="border-t border-border px-5 py-7 sm:px-10">
        <div className="mx-auto grid max-w-7xl gap-6">
          <SpeakerNav />
          <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Open Events. Open-source conference operations.</span>
            <a
              href="https://github.com/MoizIbnYousaf/open-events"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground hover:text-link"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
