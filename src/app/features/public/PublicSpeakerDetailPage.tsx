import { useEffect, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'

import { Avatar, AvatarFallback } from '../../../components/ui/avatar'
import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/empty-state'
import { PageHeader, PageHeaderContent, PageHeaderTitle } from '../../../components/ui/page-header'
import { usePublicSchedule } from '../../queries/public-schedule'
import { usePublicSpeaker } from '../../queries/public-speakers'

export default function PublicSpeakerDetailPage() {
  const params = useParams({ strict: false })
  const eventSlug = params.eventSlug as string | undefined
  const contactId = params.contactId as string | undefined
  const query = usePublicSpeaker(eventSlug, contactId)
  const scheduleQuery = usePublicSchedule(eventSlug)

  useEffect(() => {
    document.title = 'Speaker — Open Events'
  }, [])

  const person = query.data
  if (query.isPending) {
    return (
      <PageHeader surface="wash">
        <PageHeaderContent>
          <PageHeaderTitle>Speaker</PageHeaderTitle>
        </PageHeaderContent>
      </PageHeader>
    )
  }
  if (person === null || person === undefined) {
    return (
      <EmptyState title="Speaker not found" description="That speaker is not on this programme." />
    )
  }
  const photo = person.photoUrl !== null && person.photoUrl !== '' ? person.photoUrl : null
  const timezone = scheduleQuery.data?.timezone ?? 'UTC'
  const initials =
    person.name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2) || '?'

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <PageHeader surface="wash">
        <PageHeaderContent>
          <PageHeaderTitle>{person.name}</PageHeaderTitle>
        </PageHeaderContent>
      </PageHeader>
      <div className="h-[280px] overflow-hidden rounded-lg bg-muted">
        {photo !== null ? (
          <img src={photo} alt={person.name} className="size-full object-cover" />
        ) : (
          <Avatar className="size-full rounded-none">
            <AvatarFallback className="rounded-none text-2xl">{initials}</AvatarFallback>
          </Avatar>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {person.jobTitle}
        {person.company !== '' ? ` · ${person.company}` : ''}
      </p>
      {person.bio !== '' ? <SpeakerBio text={person.bio} /> : null}
      <h2 className="text-[15px] font-medium">Sessions ({person.sessions.length})</h2>
      <ul className="grid gap-2">
        {person.sessions.map((session) => (
          <li key={session.submissionId} className="text-sm">
            {session.title} · {session.day} · {formatSessionClock(session.start, timezone)} –{' '}
            {formatSessionClock(session.end, timezone)} · {session.room}
          </li>
        ))}
      </ul>
      <Link to="/speakers/$eventSlug" params={{ eventSlug: eventSlug ?? '' }} className="underline">
        Back to speakers
      </Link>
    </div>
  )
}

function formatSessionClock(value: string, timezone: string): string {
  if (/^\d{1,2}:\d{2}/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(date)
}

function SpeakerBio({ text }: { readonly text: string }) {
  const long = text.length > 140
  if (!long) return <p className="whitespace-pre-wrap">{text}</p>
  return <ExpandableBio text={text} />
}

function ExpandableBio({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <p className="whitespace-pre-wrap">{open ? text : text.slice(0, 140)}</p>
      <Button
        type="button"
        variant="link"
        className="h-auto px-0"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Show less' : 'Show more'}
      </Button>
    </div>
  )
}
