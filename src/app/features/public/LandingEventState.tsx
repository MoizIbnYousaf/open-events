import type { ReactNode } from 'react'

import type { EventDto } from '../../../application/dtos/event-dto'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { InboxIcon } from '../../../components/ui/icons'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { useLandingEvent } from '../../queries/public-event'

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

/**
 * A masthead title, not a toolbar one: the front door has no chrome strip to
 * sit in, so the heading wraps instead of truncating. An event whose name runs
 * long is a real event; clipping its name at the door is the one thing this
 * page must not do.
 */
const landingTitleClass = 'text-clip text-balance'

const formatterByTimezone = new Map<string, Intl.DateTimeFormat>()
const fallbackFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'full',
  timeStyle: 'short',
})

function formatEventDate(iso: string, timezone: string): string {
  try {
    let formatter = formatterByTimezone.get(timezone)
    if (formatter === undefined) {
      formatter = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      })
      formatterByTimezone.set(timezone, formatter)
    }
    return formatter.format(new Date(iso))
  } catch {
    return fallbackFormatter.format(new Date(iso))
  }
}

/**
 * One fact about the event, on the product's definition-list rhythm: hairline
 * between rows, label in the tertiary 12px, value at 14px.
 *
 * Below `sm` the label sits ABOVE its value rather than opposite it. The old
 * row put the two on one line at every width, which on a phone left the date
 * squeezed into whatever the label did not take and broken across three ragged
 * lines. Two columns is a treatment a wide row can afford, not a truth about
 * the data.
 */
function DetailRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-foreground">{children}</dd>
    </div>
  )
}

function renderEventCard(event: EventDto) {
  return (
    <div className="grid gap-4">
      {/* The status belongs beside the name, not buried three rows into the
          card: it is the one fact that changes how everything below it reads. */}
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle className={landingTitleClass}>{event.name}</PageHeaderTitle>
        </PageHeaderContent>
        <PageHeaderActions>
          <Badge dot variant={STATUS_VARIANTS[event.status]}>
            {STATUS_LABELS[event.status]}
          </Badge>
        </PageHeaderActions>
      </PageHeader>
      <Card>
        <CardContent>
          <dl className="divide-y divide-border">
            <DetailRow label="Timezone">{event.timezone}</DetailRow>
            <DetailRow label="Starts">
              {event.startsAt === null
                ? 'Not set'
                : formatEventDate(event.startsAt, event.timezone)}
            </DetailRow>
            <DetailRow label="Ends">
              {event.endsAt === null ? 'Not set' : formatEventDate(event.endsAt, event.timezone)}
            </DetailRow>
          </dl>
        </CardContent>
      </Card>
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
    <div aria-busy="true" aria-label="Loading event status" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-5 w-16 sm:ml-auto" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-64" />
          <StatusLive aria-live="polite">Loading event status…</StatusLive>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LandingEventState() {
  const eventQuery = useLandingEvent()
  if (eventQuery.isPending) return renderSkeleton()

  if (eventQuery.isError) {
    const message =
      eventQuery.error instanceof Error ? eventQuery.error.message : 'Unable to load the event.'
    return (
      <div className="grid gap-4">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle className={landingTitleClass}>
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
    )
  }

  if (eventQuery.data === null) {
    // Nothing here by configuration, not by failure — so it wears the empty
    // face rather than the error one, and the sentence that explains it is the
    // page's single status region.
    return (
      <div className="grid gap-4">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle className={landingTitleClass}>Event not found</PageHeaderTitle>
          </PageHeaderContent>
        </PageHeader>
        <EmptyState
          icon={<InboxIcon size={20} />}
          title={<StatusLive>No event named DemoConf 2026 is configured yet.</StatusLive>}
          description="An organizer has not published this event yet. The speaker portal below still works."
        />
      </div>
    )
  }

  return renderEventCard(eventQuery.data)
}
