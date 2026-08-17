import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'

import {
  buildAgendaAggregates,
  deriveReq014Views,
  trackGroupLabel,
  UNTRACKED_GROUP_KEY,
  UNTRACKED_GROUP_LABEL,
  type AgendaPlacement,
} from '../../../domain/agenda'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table'
import { SectionHeading } from '../../../components/ui/section-heading'
import { ClipboardIcon } from '../../../components/ui/icons'
import {
  usePublicSchedule,
  type PublicScheduleEnvelope,
  type PublicScheduleSession,
} from '../../queries/public-schedule'
import { DeniedState } from '../admin/AdminStates'
import {
  buildPublicAgenda,
  cellKey,
  readPersonalSchedule,
  sessionsOnDay,
  writePersonalSchedule,
} from './schedule-agenda'

interface PublicSchedulePageProps {
  readonly eventSlug?: string
}

const SCHEDULE_VIEW_NAMES = ['List', 'Day', 'Week', 'Track', 'Room'] as const
type ScheduleViewName = (typeof SCHEDULE_VIEW_NAMES)[number]

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

/** One column rhythm for every state, so the page never re-flows as it settles. */
function SchedulePage({ children }: { readonly children: ReactNode }) {
  return <div className="grid min-w-0 gap-4">{children}</div>
}

function ScheduleHeading({ description }: { readonly description?: string }) {
  return (
    <PageHeader surface="wash">
      <PageHeaderContent>
        <PageHeaderTitle>Schedule</PageHeaderTitle>
        {description !== undefined && <PageHeaderDescription>{description}</PageHeaderDescription>}
      </PageHeaderContent>
    </PageHeader>
  )
}

function ScheduleArtwork({ schedule }: { readonly schedule: PublicScheduleEnvelope }) {
  if (schedule.logoUrl == null && schedule.backgroundUrl == null) return null
  return (
    <div className="relative h-40 overflow-hidden rounded-lg border border-border bg-muted/40 sm:h-52">
      {schedule.backgroundUrl == null ? null : (
        <img
          src={schedule.backgroundUrl}
          width={schedule.backgroundWidth ?? undefined}
          height={schedule.backgroundHeight ?? undefined}
          alt={`${schedule.eventName ?? 'Event'} background`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/15 to-transparent" />
      {schedule.logoUrl == null ? null : (
        <img
          src={schedule.logoUrl}
          width={schedule.logoWidth ?? undefined}
          height={schedule.logoHeight ?? undefined}
          alt={`${schedule.eventName ?? 'Event'} logo`}
          className="absolute bottom-5 left-5 max-h-16 max-w-56 object-contain drop-shadow-lg"
        />
      )}
    </div>
  )
}

function ScheduleScreen({ eventSlug }: { readonly eventSlug: string | undefined }) {
  const query = usePublicSchedule(eventSlug)

  useEffect(() => {
    document.title = 'Schedule — Open Events'
  }, [])

  if (query.data === null) {
    return <DeniedState />
  }
  if (query.isError) {
    // This branch used to be a dead end: an alert and nothing to press. An
    // attendee refreshing a phone on a conference floor needs a control, and
    // the control has to say when it is already working — so the refetch is
    // reader-pressed and the button carries its own pending state.
    return (
      <SchedulePage>
        <ScheduleHeading />
        <Card>
          <CardContent className="grid justify-items-start gap-3">
            <AlertLive>Unable to load the schedule.</AlertLive>
            <Button
              variant="outline"
              pending={query.isFetching}
              onClick={() => {
                void query.refetch()
              }}
            >
              {query.isFetching ? 'Trying again…' : 'Retry'}
            </Button>
          </CardContent>
        </Card>
      </SchedulePage>
    )
  }
  if (query.data === undefined) {
    // No h1 while loading: the page has not yet earned a title, and announcing
    // one would tell a screen reader the schedule had arrived.
    return (
      <section aria-label="Schedule" aria-busy={query.isPending}>
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <StatusLive aria-live="polite">Loading the schedule…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }
  if (query.data.sessions.length === 0) {
    // A passive state with nothing for the reader to do, so the copy stays
    // neutral rather than borrowing an imperative it cannot deliver on.
    return (
      <SchedulePage>
        <ScheduleHeading />
        <EmptyState
          icon={<ClipboardIcon size={20} />}
          title={
            <StatusLive className="text-sm font-medium text-foreground">
              No schedule yet.
            </StatusLive>
          }
          description="Sessions appear here as soon as the organizer publishes the programme."
        />
      </SchedulePage>
    )
  }
  return (
    <ScheduleViews
      eventSlug={eventSlug ?? ''}
      timezone={query.data.timezone}
      sessions={query.data.sessions}
      schedule={query.data}
    />
  )
}

function ScheduleViews({
  eventSlug,
  timezone,
  sessions,
  schedule,
}: {
  readonly eventSlug: string
  readonly timezone: string
  readonly sessions: readonly PublicScheduleSession[]
  readonly schedule: PublicScheduleEnvelope
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

  const sessionCount = sessions.length
  const agenda = useMemo(() => buildPublicAgenda(sessions, timezone), [sessions, timezone])
  const [dayOverride, setDayOverride] = useState<string | null>(null)
  const day = dayOverride ?? agenda.days[0] ?? ''
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ScheduleViewName>('List')
  const [starred, setStarred] = useState<readonly string[]>(() =>
    eventSlug === '' ? [] : readPersonalSchedule(eventSlug),
  )
  const selected = selectedId === null ? undefined : byId.get(selectedId)
  const itinerary = sessionsOnDay(sessions, timezone, day)
  const personal = sessions
    .filter((session) => starred.includes(session.submissionId))
    .sort((left, right) => left.start.localeCompare(right.start))

  const toggleStar = (submissionId: string) => {
    const next = starred.includes(submissionId)
      ? starred.filter((id) => id !== submissionId)
      : [...starred, submissionId]
    setStarred(next)
    if (eventSlug !== '') writePersonalSchedule(eventSlug, next)
  }

  return (
    <div className="grid min-w-0 gap-6" data-tour="schedule-page">
      <ScheduleHeading
        description={`${String(sessionCount)} ${sessionCount === 1 ? 'session' : 'sessions'} · times shown in ${timezone}`}
      />
      <ScheduleArtwork schedule={schedule} />
      {agenda.days.length > 0 ? (
        <section className="grid min-w-0 gap-3">
          <SectionHeading>Agenda</SectionHeading>
          <nav aria-label="Schedule days">
            <ul className="flex flex-wrap gap-2">
              {agenda.days.map((item) => (
                <li key={item}>
                  <Button
                    type="button"
                    variant={item === day ? 'default' : 'outline'}
                    aria-current={item === day ? 'date' : undefined}
                    onClick={() => setDayOverride(item)}
                  >
                    {item}
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
          <Table bordered className="caption-top">
            <TableCaption className="sr-only">Room by time for {day}.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Time</TableHead>
                {agenda.rooms.map((room) => (
                  <TableHead key={room} scope="col">
                    {room}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {agenda.slots.map((slot) => (
                <TableRow key={slot}>
                  <TableHead scope="row" className="tabular-nums">
                    {slot}
                  </TableHead>
                  {agenda.rooms.map((room) => {
                    const cell = agenda.cells.get(cellKey(day, room, slot)) ?? []
                    return (
                      <TableCell key={room}>
                        {cell.map((session) => (
                          <button
                            key={session.submissionId}
                            type="button"
                            className="block text-left"
                            onClick={() => setSelectedId(session.submissionId)}
                          >
                            <span className="font-medium">{session.title}</span>
                            {session.track !== '' ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {session.track}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {selected !== undefined ? (
            <Card>
              <CardContent className="grid gap-2">
                <h2 className="text-base font-medium">{selected.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {formatTime(selected.start)} – {formatTime(selected.end)} · {selected.room}
                </p>
                <p className="text-sm">{selected.description}</p>
                <p className="text-sm text-muted-foreground">
                  {selected.format} · {selected.track}
                </p>
                <Button type="button" variant="outline" onClick={() => setSelectedId(null)}>
                  Close
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </section>
      ) : null}
      <section className="grid min-w-0 gap-3">
        <SectionHeading>Itinerary</SectionHeading>
        {itinerary.map((session) => (
          <Card key={session.submissionId}>
            <CardContent className="grid gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  {session.track !== '' ? (
                    <Badge variant="outline">Track {session.track}</Badge>
                  ) : null}
                  {session.format ? <Badge variant="outline">Format {session.format}</Badge> : null}
                  <p className="font-medium">{session.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatTime(session.start)} – {formatTime(session.end)} · {session.room}
                  </p>
                  {session.description !== undefined && session.description !== '' ? (
                    <ItineraryDescription text={session.description} />
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {(
                      session.speakerCards ??
                      session.speakers.map((name) => ({ name, jobTitle: '', company: '' }))
                    )
                      .map((card) =>
                        [card.name, card.jobTitle, card.company]
                          .filter((part) => part !== '')
                          .join(', '),
                      )
                      .join(' · ')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => toggleStar(session.submissionId)}
                >
                  {starred.includes(session.submissionId)
                    ? 'Remove from my schedule'
                    : 'Add to my schedule'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
      <section className="grid min-w-0 gap-3">
        <SectionHeading>My schedule</SectionHeading>
        <p className="text-sm text-muted-foreground">
          {personal.length} {personal.length === 1 ? 'session' : 'sessions'} saved on this device.
        </p>
        {personal.map((session) => (
          <p key={session.submissionId} className="text-sm">
            {session.title} · {formatTime(session.start)}
          </p>
        ))}
        {personal.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a session to My schedule before exporting a calendar.
          </p>
        ) : (
          <a
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
            href={`/api/public/events/${encodeURIComponent(eventSlug)}/schedule.ics?ids=${encodeURIComponent(personal.map((session) => session.submissionId).join(','))}`}
          >
            Add my schedule to calendar
          </a>
        )}
      </section>
      <nav aria-label="Schedule views" className="-mx-1 overflow-x-auto px-1 sm:hidden">
        <ul className="flex w-max gap-1 pb-1">
          {SCHEDULE_VIEW_NAMES.map((name) => (
            <li key={name}>
              <Button
                type="button"
                size="sm"
                variant={activeView === name ? 'secondary' : 'ghost'}
                aria-pressed={activeView === name}
                onClick={() => setActiveView(name)}
              >
                {name}
              </Button>
            </li>
          ))}
        </ul>
      </nav>
      <ScheduleTable
        name="List"
        active={activeView === 'List'}
        caption="Every published session, in start order."
        headers={['Time', 'Title', 'Track', 'Room']}
      >
        {sessionRows(views.list).map(({ session, time }) => (
          <TableRow key={session.submissionId}>
            <TimeCell>{time}</TimeCell>
            <SessionTitle session={session} />
            <TrackCell track={session.track} />
            <TableCell className="text-muted-foreground">{session.room}</TableCell>
          </TableRow>
        ))}
      </ScheduleTable>
      <ScheduleTable
        name="Day"
        active={activeView === 'Day'}
        caption="Published sessions grouped by day."
        headers={['Day', 'Title', 'Track', 'Room']}
      >
        {Object.entries(views.day).flatMap(([day, submissionIds]) =>
          sessionRows(submissionIds).map(({ session }) => (
            <TableRow key={`${day}-${session.submissionId}`}>
              <KeyCell>{day}</KeyCell>
              <SessionTitle session={session} />
              <TrackCell track={session.track} />
              <TableCell className="text-muted-foreground">{session.room}</TableCell>
            </TableRow>
          )),
        )}
      </ScheduleTable>
      <ScheduleTable
        name="Week"
        active={activeView === 'Week'}
        caption="Published sessions grouped by ISO week."
        headers={['Week', 'Title', 'Track', 'Room']}
      >
        {Object.entries(views.week).flatMap(([week, submissionIds]) =>
          sessionRows(submissionIds).map(({ session }) => (
            <TableRow key={`${week}-${session.submissionId}`}>
              <KeyCell>{week}</KeyCell>
              <SessionTitle session={session} />
              <TrackCell track={session.track} />
              <TableCell className="text-muted-foreground">{session.room}</TableCell>
            </TableRow>
          )),
        )}
      </ScheduleTable>
      <ScheduleTable
        name="Track"
        active={activeView === 'Track'}
        caption="Published sessions grouped by track."
        headers={['Track', 'Title', 'Room', 'Day', 'Time']}
      >
        {Object.entries(views.track).flatMap(([track, submissionIds]) =>
          sessionRows(submissionIds).map(({ session, time }) => (
            <TableRow key={`${track}-${session.submissionId}`}>
              {/* The untracked group is keyed by the track it has not got, so
                  the cell that names the group has to say so in words. */}
              <KeyCell>{trackGroupLabel(track)}</KeyCell>
              <SessionTitle session={session} />
              <TableCell className="text-muted-foreground">{session.room}</TableCell>
              <KeyCell>{session.day}</KeyCell>
              <TimeCell>{time}</TimeCell>
            </TableRow>
          )),
        )}
      </ScheduleTable>
      <ScheduleTable
        name="Room"
        active={activeView === 'Room'}
        caption="Published sessions grouped by room."
        headers={['Room', 'Title', 'Track', 'Day', 'Time']}
      >
        {Object.entries(views.room).flatMap(([room, submissionIds]) =>
          sessionRows(submissionIds).map(({ session, time }) => (
            <TableRow key={`${room}-${session.submissionId}`}>
              <KeyCell>{room}</KeyCell>
              <SessionTitle session={session} />
              <TrackCell track={session.track} />
              <KeyCell>{session.day}</KeyCell>
              <TimeCell>{time}</TimeCell>
            </TableRow>
          )),
        )}
      </ScheduleTable>
    </div>
  )
}

/** The session title is the row's subject, so it is the only cell at full ink. */
function TitleCell({ children }: { readonly children: ReactNode }) {
  return <TableCell className="font-medium text-foreground">{children}</TableCell>
}

function SessionTitle({ session }: { readonly session: PublicScheduleSession }) {
  return (
    <TitleCell>
      <div className="grid gap-0.5">
        <span>{session.title}</span>
        {session.speakers.length > 0 || (session.speakerCards ?? []).length > 0 ? (
          <span className="text-xs font-normal text-muted-foreground">
            {(
              session.speakerCards ??
              session.speakers.map((name) => ({ name, jobTitle: '', company: '' }))
            )
              .map((card) =>
                [card.name, card.jobTitle, card.company].filter((part) => part !== '').join(', '),
              )
              .join(' · ')}
          </span>
        ) : null}
      </div>
    </TitleCell>
  )
}

/** Times line up as a column of digits, not as prose. */
function TimeCell({ children }: { readonly children: ReactNode }) {
  return <TableCell className="tabular-nums whitespace-nowrap">{children}</TableCell>
}

/** The grouping key a view is sorted by — present, but not competing with the title. */
function KeyCell({ children }: { readonly children: ReactNode }) {
  return <TableCell className="whitespace-nowrap text-muted-foreground">{children}</TableCell>
}

/**
 * A session's track. The chip is for a track the session really has: an empty
 * badge — 14px of coloured nothing — is not a quieter way of saying "no track",
 * it is a rendering accident an attendee has to decode. A session without one
 * says so, in the word the whole product uses for it and at the ink of a value
 * that is absent rather than named.
 *
 * The chip is `outline`, and that is a meaning rather than a taste. Colour in
 * this product says STATE — accepted, published, ready, round open — and the
 * organiser side teaches that grammar on every screen before an attendee ever
 * reaches this one. A track is not a state anything can be in; it is one value
 * drawn from a set the organiser wrote down. It wore the tinted face until now,
 * so the busiest table on the public schedule was quietly telling every reader
 * that "Workshop" is good news.
 */
function TrackCell({ track }: { readonly track: string }) {
  return (
    <TableCell>
      {track === UNTRACKED_GROUP_KEY ? (
        <span className="text-muted-foreground">{UNTRACKED_GROUP_LABEL}</span>
      ) : (
        <Badge variant="outline">{track}</Badge>
      )}
    </TableCell>
  )
}

/**
 * Each REQ-014 view is its own labelled region with its own heading, because a
 * reader jumping by landmark or heading is exactly how someone finds "the room
 * I am standing in" on a phone. The caption repeats what the region is FOR in
 * one sentence for assistive tech; sighted readers already have the heading.
 *
 * The table primitive owns the horizontal scroll, so a five-column view slides
 * inside its own box at 390px instead of dragging the page sideways.
 *
 * The frame belongs to that same scroller — `bordered` — and not to a wrapper
 * around it. A wrapper was cheaper to write and quietly wrong twice over: the
 * rounding sat on a box the content scrolled past and clipped nothing, and the
 * `overflow-hidden` it needed to look right clipped painting to its padding
 * box. The scroller fills that box exactly, and the scroller is a real tab stop
 * whose focus indicator is an OUTWARD ring — so a keyboard reader tabbing into
 * a schedule view got a focus signal that had already been cut away. An
 * element's own outward ring survives its own `overflow-x: auto`; it does not
 * survive an ancestor's `overflow: hidden`.
 */
function ScheduleTable({
  name,
  active,
  caption,
  headers,
  children,
}: {
  readonly name: string
  readonly active: boolean
  readonly caption: string
  readonly headers: readonly string[]
  readonly children: ReactNode
}) {
  return (
    <section aria-label={name} className={`min-w-0 gap-2 sm:grid ${active ? 'grid' : 'hidden'}`}>
      <SectionHeading>{name}</SectionHeading>
      <Table bordered className="[&_td]:px-3 [&_th]:px-3">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header} scope="col">
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </section>
  )
}

function ItineraryDescription({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 140
  return (
    <div>
      <p className="text-sm">{open || !long ? text : text.slice(0, 140)}</p>
      {long ? (
        <Button
          type="button"
          variant="link"
          className="h-auto px-0"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Show less' : 'Show more'}
        </Button>
      ) : null}
    </div>
  )
}

/** Keeps the envelope type referenced for consumers of the ready data. */
export type { PublicScheduleEnvelope }
