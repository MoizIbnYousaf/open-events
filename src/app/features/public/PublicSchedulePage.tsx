import { useEffect, useMemo, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'

import {
  buildAgendaAggregates,
  deriveReq014Views,
  type AgendaPlacement,
} from '../../../domain/agenda'
import { AlertLive } from '../../../components/ui/alert-live'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import {
  usePublicSchedule,
  type PublicScheduleEnvelope,
  type PublicScheduleSession,
} from '../../queries/public-schedule'
import { DeniedState } from '../admin/AdminStates'

interface PublicSchedulePageProps {
  readonly eventSlug?: string
}

export default function PublicSchedulePage({ eventSlug }: PublicSchedulePageProps) {
  if (eventSlug !== undefined) {
    return <ScheduleScreen eventSlug={eventSlug} />
  }
  return <ScheduleScreenFromParams />
}

function ScheduleScreenFromParams() {
  const params = useParams({ strict: false })
  return <ScheduleScreen eventSlug={params.eventSlug as string | undefined} />
}

function ScheduleScreen({ eventSlug }: { readonly eventSlug: string | undefined }) {
  const query = usePublicSchedule(eventSlug)

  useEffect(() => {
    document.title = 'Schedule — SpeakerOps'
  }, [])

  if (query.data === null) {
    return <DeniedState />
  }
  if (query.isError) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <Card>
          <CardContent className="grid gap-3">
            <AlertLive>Unable to load the schedule.</AlertLive>
          </CardContent>
        </Card>
      </div>
    )
  }
  if (query.data === undefined) {
    return (
      <section aria-label="Schedule" aria-busy={query.isPending}>
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-10 w-full" />
            <StatusLive>Loading the schedule…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }
  if (query.data.sessions.length === 0) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <Card>
          <CardContent>
            <StatusLive>No schedule yet.</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }
  return <ScheduleViews timezone={query.data.timezone} sessions={query.data.sessions} />
}

function ScheduleViews({
  timezone,
  sessions,
}: {
  readonly timezone: string
  readonly sessions: readonly PublicScheduleSession[]
}) {
  const views = useMemo(() => {
    const placements: AgendaPlacement[] = sessions.map((session) => ({
      submissionId: session.submissionId,
      eventId: '',
      trackId: session.track,
      roomId: session.room,
      day: session.day,
      start: session.start,
      end: session.end,
      position: session.position ?? 0,
      speakerIds: [],
    }))
    return deriveReq014Views(buildAgendaAggregates(placements))
  }, [sessions])
  const byId = useMemo(
    () => new Map(sessions.map((session) => [session.submissionId, session])),
    [sessions],
  )
  const formatTime = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    return (iso: string): string => {
      try {
        return formatter.format(new Date(iso))
      } catch {
        return iso
      }
    }
  }, [timezone])

  const sessionRows = (submissionIds: readonly string[]) =>
    submissionIds.flatMap((submissionId) => {
      const session = byId.get(submissionId)
      return session === undefined ? [] : [{ session, time: formatTime(session.start) }]
    })

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Schedule</h1>
      <ScheduleTable title="List" headers={['Time', 'Title', 'Track', 'Room']}>
        {sessionRows(views.list).map(({ session, time }) => (
          <tr key={session.submissionId}>
            <td>{time}</td>
            <td>{session.title}</td>
            <td>{session.track}</td>
            <td>{session.room}</td>
          </tr>
        ))}
      </ScheduleTable>
      <ScheduleTable title="Day" headers={['Day', 'Title', 'Track', 'Room']}>
        {Object.entries(views.day).flatMap(([day, submissionIds]) =>
          sessionRows(submissionIds).map(({ session }) => (
            <tr key={`${day}-${session.submissionId}`}>
              <td>{day}</td>
              <td>{session.title}</td>
              <td>{session.track}</td>
              <td>{session.room}</td>
            </tr>
          )),
        )}
      </ScheduleTable>
      <ScheduleTable title="Week" headers={['Week', 'Title', 'Track', 'Room']}>
        {Object.entries(views.week).flatMap(([week, submissionIds]) =>
          sessionRows(submissionIds).map(({ session }) => (
            <tr key={`${week}-${session.submissionId}`}>
              <td>{week}</td>
              <td>{session.title}</td>
              <td>{session.track}</td>
              <td>{session.room}</td>
            </tr>
          )),
        )}
      </ScheduleTable>
      <ScheduleTable title="Track" headers={['Track', 'Title', 'Room', 'Day', 'Time']}>
        {Object.entries(views.track).flatMap(([track, submissionIds]) =>
          sessionRows(submissionIds).map(({ session, time }) => (
            <tr key={`${track}-${session.submissionId}`}>
              <td>{track}</td>
              <td>{session.title}</td>
              <td>{session.room}</td>
              <td>{session.day}</td>
              <td>{time}</td>
            </tr>
          )),
        )}
      </ScheduleTable>
      <ScheduleTable title="Room" headers={['Room', 'Title', 'Track', 'Day', 'Time']}>
        {Object.entries(views.room).flatMap(([room, submissionIds]) =>
          sessionRows(submissionIds).map(({ session, time }) => (
            <tr key={`${room}-${session.submissionId}`}>
              <td>{room}</td>
              <td>{session.title}</td>
              <td>{session.track}</td>
              <td>{session.day}</td>
              <td>{time}</td>
            </tr>
          )),
        )}
      </ScheduleTable>
    </div>
  )
}

function ScheduleTable({
  title,
  headers,
  children,
}: {
  readonly title: string
  readonly headers: readonly string[]
  readonly children: ReactNode
}) {
  return (
    <section aria-label={title} className="grid gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col" className="px-3 py-2 text-left font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  )
}

/** Keeps the envelope type referenced for consumers of the ready data. */
export type { PublicScheduleEnvelope }
