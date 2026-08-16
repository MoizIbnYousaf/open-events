import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import type { EventDto } from '../../../application/dtos/event-dto'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { buttonVariants } from '../../../components/ui/button-variants'
import { Card, CardContent, CardDescription } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { InboxIcon } from '../../../components/ui/icons'
import { linkVariants } from '../../../components/ui/link-variants'
import { PageHeader, PageHeaderContent, PageHeaderTitle } from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'
import { useLandingEvent } from '../../queries/public-event'
import SpeakerNav from './SpeakerNav'

const STATUS_LABELS: Record<EventDto['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

/**
 * The event's lifecycle state, on the same two faces every other lifecycle
 * chip in the product wears: `secondary` for the live/positive state, `outline`
 * for every state that is not it, and a leading dot on all of them because a
 * state chip is told apart from a value chip by shape, not by tint.
 *
 * These were inverted. `published` rendered on the neutral face while `draft`
 * took the tinted one, so the front door taught a reader the opposite grammar
 * from the one the agenda, the form versions, the readiness rows, the rounds
 * and the accepted proposals all use — on the first screen anyone sees.
 *
 * `draft` and `archived` share the quiet face on purpose. Neither is the live
 * state, the label says which one it is, and inventing a third tint to
 * separate them would spend the one structural accent this product owns on a
 * distinction the word already carries.
 */
const STATUS_VARIANTS = {
  draft: 'outline',
  published: 'secondary',
  archived: 'outline',
} as const

/** Display type for the public front door. */
const HERO_TITLE_CLASS =
  'max-w-[880px] text-balance text-[32px] leading-9 font-semibold tracking-[-0.04em] text-foreground sm:text-[48px] sm:leading-[52px]'

const dateRangeFormatterByTimezone = new Map<string, Intl.DateTimeFormat>()

function formatHeroRange(startsAt: string | null, endsAt: string | null, timezone: string): string {
  if (startsAt === null) return ''
  try {
    let formatter = dateRangeFormatterByTimezone.get(timezone)
    if (formatter === undefined) {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
      })
      dateRangeFormatterByTimezone.set(timezone, formatter)
    }
    const start = formatter.format(new Date(startsAt))
    if (endsAt === null) return start
    const end = formatter.format(new Date(endsAt))
    return start === end ? start : `${start} – ${end}`
  } catch {
    return ''
  }
}

function heroEyebrow(event: EventDto): string {
  const range = formatHeroRange(event.startsAt, event.endsAt, event.timezone)
  return range === '' ? event.name.toUpperCase() : `${event.name.toUpperCase()} · ${range}`
}

const STEPS = [
  { n: '01', title: 'Collect', copy: 'A CFP speakers finish.' },
  { n: '02', title: 'Review', copy: 'Score. Decide. Next.' },
  { n: '03', title: 'Onboard', copy: 'A portal, not a thread.' },
  { n: '04', title: 'Schedule', copy: 'Drag. Catch conflicts.' },
  { n: '05', title: 'Publish', copy: 'Programme + ICS.' },
] as const

function RoleCards() {
  return (
    <div className="grid gap-3 px-5 sm:grid-cols-3 sm:px-10">
      <Link
        to="/admin"
        className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-[11px] font-medium tracking-[0.06em] text-link">ORGANIZER</span>
        <span className="text-base font-semibold text-foreground">Today’s desk</span>
        <span className="text-[13px] leading-5 text-muted-foreground">
          Ranked work. Place four talks. Preview publish.
        </span>
      </Link>
      <Link
        to="/evaluations"
        className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-[11px] font-medium tracking-[0.06em] text-link">REVIEWER</span>
        <span className="text-base font-semibold text-foreground">Score and next</span>
        <span className="text-[13px] leading-5 text-muted-foreground">
          1–5 on Clarity. Recuse. Submit and next.
        </span>
      </Link>
      <Link
        to="/portal"
        className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-[11px] font-medium tracking-[0.06em] text-link">SPEAKER</span>
        <span className="text-base font-semibold text-foreground">One next task</span>
        <span className="text-[13px] leading-5 text-muted-foreground">
          Upload a headshot. Confirm travel. Done.
        </span>
      </Link>
    </div>
  )
}

function StepStrip() {
  return (
    <div className="flex flex-col border-t border-border sm:flex-row">
      {STEPS.map((step, index) => (
        <div
          key={step.n}
          className={`flex min-w-0 flex-1 flex-col gap-1.5 px-5 py-4 sm:px-5 ${
            index < STEPS.length - 1 ? 'border-b border-border sm:border-r sm:border-b-0' : ''
          }`}
        >
          <span className="text-[11px] font-medium text-muted-foreground">{step.n}</span>
          <span className="text-sm font-semibold text-foreground">{step.title}</span>
          <span className="text-xs leading-[18px] text-muted-foreground">{step.copy}</span>
        </div>
      ))}
    </div>
  )
}

function FrontActions() {
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-5 pb-6 sm:px-10">
      <Link
        to="/cfp/$eventSlug/$formSlug"
        params={{ eventSlug: DEFAULT_EVENT_SLUG, formSlug: DEFAULT_FORM_SLUG }}
        className={buttonVariants()}
      >
        Submit a talk
      </Link>
      <Link
        to="/schedule/$eventSlug"
        params={{ eventSlug: DEFAULT_EVENT_SLUG }}
        className={buttonVariants({ variant: 'outline' })}
      >
        See the programme
      </Link>
      <Link to="/start" className={`text-xs text-muted-foreground ${linkVariants()}`}>
        Starting a proposal? Request your CFP link
      </Link>
    </div>
  )
}

function FrontFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative flex flex-col">
      {children}
      <RoleCards />
      <div className="h-7" />
      <StepStrip />
      <div className="pt-4">
        <FrontActions />
      </div>
      <div className="px-5 pb-8 sm:px-10">
        <SpeakerNav />
      </div>
    </div>
  )
}

/**
 * The shape the page is about to take, heading and all — so nothing jumps when
 * the event lands. It carries no heading of its own: a skeleton h1 would be an
 * empty landmark in the heading outline for as long as the request runs.
 */
function renderSkeleton() {
  return (
    <FrontFrame>
      <div
        aria-busy="true"
        aria-label="Loading event status"
        className="flex max-w-[880px] flex-col gap-4 px-5 pt-12 pb-7 sm:px-10"
      >
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-12 w-full max-w-xl" />
        <Skeleton className="h-4 w-80" />
        <StatusLive aria-live="polite">Loading event status…</StatusLive>
      </div>
    </FrontFrame>
  )
}

export default function LandingEventState() {
  const eventQuery = useLandingEvent()
  if (eventQuery.isPending) return renderSkeleton()

  if (eventQuery.isError) {
    const message =
      eventQuery.error instanceof Error ? eventQuery.error.message : 'Unable to load the event.'
    return (
      <FrontFrame>
        <div className="grid max-w-[880px] gap-4 px-5 pt-12 pb-7 sm:px-10">
          <PageHeader surface="wash">
            <PageHeaderContent>
              <PageHeaderTitle className="text-clip text-balance">
                Could not load DemoConf 2026
              </PageHeaderTitle>
            </PageHeaderContent>
          </PageHeader>
          <Card>
            <CardContent className="grid justify-items-start gap-3">
              <CardDescription role="alert">{message}</CardDescription>
              <Button variant="outline" onClick={() => void eventQuery.refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        </div>
      </FrontFrame>
    )
  }

  if (eventQuery.data === null) {
    return (
      <FrontFrame>
        <div className="grid max-w-[880px] gap-4 px-5 pt-12 pb-7 sm:px-10">
          <PageHeader surface="wash">
            <PageHeaderContent>
              <PageHeaderTitle className="text-clip text-balance">Event not found</PageHeaderTitle>
            </PageHeaderContent>
          </PageHeader>
          <EmptyState
            icon={<InboxIcon size={20} />}
            title={<StatusLive>No event named DemoConf 2026 is configured yet.</StatusLive>}
            description="An organizer has not published this event yet. Invited speakers can still use their private portal links."
          />
        </div>
      </FrontFrame>
    )
  }

  const event = eventQuery.data
  return (
    <FrontFrame>
      <div className="flex max-w-[880px] flex-col gap-4 px-5 pt-12 pb-7 sm:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium tracking-[0.06em] text-link">{heroEyebrow(event)}</p>
          <Badge dot variant={STATUS_VARIANTS[event.status]}>
            {STATUS_LABELS[event.status]}
          </Badge>
        </div>
        <h1 className={HERO_TITLE_CLASS}>Run the whole programme in one place.</h1>
        <p className="max-w-[880px] text-base leading-[26px] text-muted-foreground">
          Call for papers, review, speaker onboarding, and the published agenda. CFP authors can
          request a proposal link; organizers issue private links for speakers and reviewers.
        </p>
      </div>
    </FrontFrame>
  )
}
