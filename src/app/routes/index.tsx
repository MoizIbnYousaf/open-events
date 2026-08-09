import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { EventDto } from '../../application/dtos/event-dto'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { getEventBySlug } from '../api/events'

export const Route = createFileRoute('/')({
  component: IndexPage,
})

const DEMO_CONF_2026_SLUG = 'demo-conf-2026'

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

type EventState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'empty' }
  | { readonly status: 'ready'; readonly event: EventDto }

function IndexPage() {
  const [state, setState] = useState<EventState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    document.title = 'DemoConf 2026 — SpeakerOps'
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const loadEvent = async (): Promise<void> => {
      try {
        const event = await getEventBySlug(DEMO_CONF_2026_SLUG, { signal: controller.signal })
        if (controller.signal.aborted) {
          return
        }
        setState(event === null ? { status: 'empty' } : { status: 'ready', event })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to load the event.',
        })
      }
    }
    void loadEvent()
    return () => controller.abort()
  }, [attempt])

  const retry = () => {
    setState({ status: 'loading' })
    setAttempt((current) => current + 1)
  }

  if (state.status === 'loading') {
    return <EventCardSkeleton />
  }

  if (state.status === 'error') {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-xl leading-snug font-medium">
            Could not load DemoConf 2026
          </h2>
          <CardDescription role="alert">{state.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (state.status === 'empty') {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-xl leading-snug font-medium">Event not found</h2>
          <CardDescription role="status">
            No event named DemoConf 2026 is configured yet.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return <EventCard event={state.event} />
}

function EventCard({ event }: { readonly event: EventDto }) {
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

function EventCardSkeleton() {
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
      </CardContent>
    </Card>
  )
}

function formatEventDate(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(iso))
  }
}
