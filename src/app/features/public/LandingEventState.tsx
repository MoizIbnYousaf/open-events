import type { EventDto } from '../../../application/dtos/event-dto'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { useLandingEvent } from '../../queries/public-event'

const STATUS_LABELS: Record<EventDto['status'], string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

const STATUS_VARIANTS = {
  draft: 'secondary',
  published: 'default',
  archived: 'outline',
} as const

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

function renderEventCard(event: EventDto) {
  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-xl leading-snug font-medium">{event.name}</h1>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd>
              <Badge variant={STATUS_VARIANTS[event.status]}>{STATUS_LABELS[event.status]}</Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-muted-foreground">Timezone</dt>
            <dd className="text-sm">{event.timezone}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-muted-foreground">Starts</dt>
            <dd className="text-sm text-right">
              {event.startsAt === null
                ? 'Not set'
                : formatEventDate(event.startsAt, event.timezone)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-muted-foreground">Ends</dt>
            <dd className="text-sm text-right">
              {event.endsAt === null ? 'Not set' : formatEventDate(event.endsAt, event.timezone)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

function renderSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading event status">
      <CardHeader>
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-4 w-36" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-64" />
        <StatusLive aria-live="polite">Loading event status…</StatusLive>
      </CardContent>
    </Card>
  )
}

export default function LandingEventState() {
  const eventQuery = useLandingEvent()
  if (eventQuery.isPending) return renderSkeleton()

  if (eventQuery.isError) {
    const message =
      eventQuery.error instanceof Error ? eventQuery.error.message : 'Unable to load the event.'
    return (
      <Card>
        <CardHeader>
          <h1 className="font-heading text-xl leading-snug font-medium">
            Could not load DemoConf 2026
          </h1>
          <CardDescription role="alert">{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void eventQuery.refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (eventQuery.data === null) {
    return (
      <Card>
        <CardHeader>
          <h1 className="font-heading text-xl leading-snug font-medium">Event not found</h1>
          <CardDescription role="status">
            No event named DemoConf 2026 is configured yet.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return renderEventCard(eventQuery.data)
}
