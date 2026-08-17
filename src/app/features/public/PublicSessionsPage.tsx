import { useEffect, useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '../../../components/ui/input-group'
import { NativeSelect } from '../../../components/ui/native-select'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { StatusLive } from '../../../components/ui/status-live'
import { usePublicSchedule } from '../../queries/public-schedule'

export default function PublicSessionsPage({ eventSlug }: { readonly eventSlug?: string } = {}) {
  const params = useParams({ strict: false })
  const slug = eventSlug ?? (params.eventSlug as string | undefined)
  const query = usePublicSchedule(slug)
  const [term, setTerm] = useState('')
  const [track, setTrack] = useState('')
  const [format, setFormat] = useState('')
  const [room, setRoom] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Sessions — Open Events'
  }, [])

  const sessions = useMemo(() => query.data?.sessions ?? [], [query.data])
  const timezone = query.data?.timezone ?? 'UTC'
  const formatClock = useMemo(() => {
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
  const { tracks, formats, rooms } = useMemo(() => {
    const trackSet = new Set<string>()
    const formatSet = new Set<string>()
    const roomSet = new Set<string>()
    for (const session of sessions) {
      if (session.track !== '') trackSet.add(session.track)
      if ((session.format ?? '') !== '') formatSet.add(session.format ?? '')
      if (session.room !== '') roomSet.add(session.room)
    }
    return {
      tracks: [...trackSet],
      formats: [...formatSet],
      rooms: [...roomSet],
    }
  }, [sessions])
  const shown = sessions.filter((session) => {
    const speakerText = (session.speakerCards ?? [])
      .map((card) => `${card.name} ${card.jobTitle} ${card.company}`)
      .join(' ')
    const hay = `${session.title} ${session.speakers.join(' ')} ${speakerText}`.toLowerCase()
    if (term.trim() !== '' && !hay.includes(term.trim().toLowerCase())) return false
    if (track !== '' && session.track !== track) return false
    if (format !== '' && (session.format ?? '') !== format) return false
    if (room !== '' && session.room !== room) return false
    return true
  })

  return (
    <div className="grid gap-4" data-tour="session-catalogue">
      <PageHeader surface="wash">
        <PageHeaderContent>
          <PageHeaderTitle>Sessions</PageHeaderTitle>
          <PageHeaderDescription>Search and filter the published programme.</PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <img
        src="/session-stage.jpg"
        alt=""
        className="h-44 w-full rounded-lg object-cover object-center shadow-sm sm:h-56"
      />
      <div className="grid max-w-3xl gap-3">
        <Field>
          <FieldLabel htmlFor="session-search">Search sessions</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>Find</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="session-search"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </InputGroup>
        </Field>
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="text-sm font-medium">Filters</legend>
          <Field>
            <FieldLabel htmlFor="session-track">Track</FieldLabel>
            <NativeSelect
              id="session-track"
              value={track}
              onChange={(event) => setTrack(event.target.value)}
            >
              <option value="">All tracks</option>
              {tracks.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="session-format">Format</FieldLabel>
            <NativeSelect
              id="session-format"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option value="">All formats</option>
              {formats.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="session-location">Location</FieldLabel>
            <NativeSelect
              id="session-location"
              value={room}
              onChange={(event) => setRoom(event.target.value)}
            >
              <option value="">All rooms</option>
              {rooms.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </fieldset>
      </div>
      <StatusLive>
        {shown.length} of {sessions.length} session{sessions.length === 1 ? '' : 's'} shown.
      </StatusLive>
      {shown.length === 0 ? (
        <EmptyState title="No sessions match" description="Clear the search or track filter." />
      ) : (
        <div className="mx-auto grid w-full max-w-3xl gap-3">
          {shown.map((session) => {
            const description = session.description ?? ''
            const open = openId === session.submissionId
            return (
              <Card key={session.submissionId}>
                <CardContent className="grid gap-2">
                  <p className="font-medium">{session.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {session.day} · {formatClock(session.start)} – {formatClock(session.end)} ·{' '}
                    {session.room}
                  </p>
                  <p className="text-sm">
                    {(session.speakerCards ?? []).map((card) => (
                      <span key={card.name} className="mr-3">
                        {card.name}
                        {card.jobTitle !== '' ? `, ${card.jobTitle}` : ''}
                        {card.company !== '' ? `, ${card.company}` : ''}
                      </span>
                    ))}
                    {(session.speakerCards ?? []).length === 0
                      ? session.speakers.join(' · ')
                      : null}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {session.format ? (
                      <Badge variant="outline">Format {session.format}</Badge>
                    ) : null}
                    {session.track ? <Badge variant="outline">Track {session.track}</Badge> : null}
                  </div>
                  {description !== '' ? (
                    <>
                      <p className="text-sm">{open ? description : description.slice(0, 140)}</p>
                      {description.length > 140 ? (
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto justify-self-start px-0"
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? null : session.submissionId)}
                        >
                          {open ? 'Show less' : 'Show more'}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
