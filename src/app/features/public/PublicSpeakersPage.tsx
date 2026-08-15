import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useParams } from '@tanstack/react-router'

import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '../../../components/ui/input-group'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { StatusLive } from '../../../components/ui/status-live'
import { ToggleGroup, ToggleGroupItem } from '../../../components/ui/toggle-group'
import { cn } from '../../../lib/utils'
import { usePublicSpeakers, type PublicSpeaker } from '../../queries/public-speakers'

export default function PublicSpeakersPage({ gallery = false }: { readonly gallery?: boolean }) {
  const params = useParams({ strict: false })
  const eventSlug = params.eventSlug as string | undefined
  const query = usePublicSpeakers(eventSlug)
  const [term, setTerm] = useState('')
  const [mode, setMode] = useState<'list' | 'gallery'>('gallery')

  useEffect(() => {
    document.title = gallery ? 'Speaker gallery — Open Events' : 'Speakers — Open Events'
  }, [gallery])

  const people = useMemo(() => query.data ?? [], [query.data])
  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (needle === '') return people
    return people.filter((person) =>
      `${person.name} ${person.jobTitle} ${person.company} ${person.sessions.map((session) => session.title).join(' ')}`
        .toLowerCase()
        .includes(needle),
    )
  }, [people, term])
  if (params.contactId !== undefined) return <Outlet />

  return (
    <div className="grid gap-5">
      <PageHeader surface="wash">
        <PageHeaderContent>
          <PageHeaderTitle>{gallery ? 'Speaker gallery' : 'Speakers'}</PageHeaderTitle>
          <PageHeaderDescription>
            Published speakers, ordered by surname. Missing photos fall back to initials.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <img
        src="/speakers-conversation.jpg"
        alt=""
        className="h-44 w-full rounded-lg object-cover object-center shadow-sm sm:h-56"
      />
      <div className="flex flex-wrap items-end gap-3">
        <ToggleGroup
          value={[mode]}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Speaker layout"
          onValueChange={(next) => {
            const chosen = next[0]
            if (chosen === 'list' || chosen === 'gallery') setMode(chosen)
          }}
        >
          <ToggleGroupItem value="list">List</ToggleGroupItem>
          <ToggleGroupItem value="gallery">Gallery</ToggleGroupItem>
        </ToggleGroup>
        <Field className="max-w-sm min-w-0 flex-1">
          <FieldLabel htmlFor="speaker-search">Search speakers</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>Find</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="speaker-search"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </InputGroup>
        </Field>
      </div>
      <StatusLive>
        {shown.length} of {people.length} speaker{people.length === 1 ? '' : 's'} shown.
      </StatusLive>
      {shown.length === 0 ? (
        <EmptyState title="No speakers match" description="Try another name." />
      ) : (
        <ul
          className={
            mode === 'gallery'
              ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
              : 'mx-auto grid w-full max-w-3xl gap-1'
          }
        >
          {shown.map((person) => (
            <li key={person.id}>
              <SpeakerTile person={person} eventSlug={eventSlug ?? ''} layout={mode} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function speakerInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
}

function speakerLine(person: PublicSpeaker): string {
  // Gallery anatomy the public-widget rubric asks for: job title and company
  // on the card, not the talk they happen to be giving. The talk stays a
  // third line so a directory without titles is still not empty.
  return [person.jobTitle, person.company].filter((part) => part !== '').join(' · ')
}

function speakerTalk(person: PublicSpeaker): string {
  const talk = person.sessions[0]
  if (talk === undefined) return ''
  return talk.room === '' ? talk.title : `${talk.title} · ${talk.room}`
}

function speakerPhoto(person: PublicSpeaker, eventSlug: string): string | null {
  return (
    person.photoUrl ??
    (person.hasHeadshot ? `/api/public/events/${eventSlug}/speakers/${person.id}/headshot` : null)
  )
}

function SpeakerTile({
  person,
  eventSlug,
  layout,
}: {
  readonly person: PublicSpeaker
  readonly eventSlug: string
  readonly layout: 'list' | 'gallery'
}) {
  const photo = speakerPhoto(person, eventSlug)
  const line = speakerLine(person)
  const talk = speakerTalk(person)
  const initials = speakerInitials(person.name) || '?'

  if (layout === 'list') {
    return (
      <Link
        to="/speakers/$eventSlug/$contactId"
        params={{ eventSlug, contactId: person.id }}
        className="flex items-center gap-3 rounded-md px-2 py-2 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SpeakerPhoto photo={photo} name={person.name} initials={initials} compact />
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-[15px] leading-[18px] font-semibold text-foreground">
            {person.name}
          </span>
          {line !== '' ? (
            <span className="truncate text-[13px] text-muted-foreground">{line}</span>
          ) : null}
          {talk !== '' ? (
            <span className="truncate text-[12px] text-muted-foreground">{talk}</span>
          ) : null}
        </span>
      </Link>
    )
  }

  return (
    <Link
      to="/speakers/$eventSlug/$contactId"
      params={{ eventSlug, contactId: person.id }}
      className="grid gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SpeakerPhoto photo={photo} name={person.name} initials={initials} />
      <span className="grid gap-0.5">
        <span className="text-[15px] leading-[18px] font-semibold text-foreground">
          {person.name}
        </span>
        {line !== '' ? (
          <span className="text-[13px] leading-4 text-muted-foreground">{line}</span>
        ) : null}
        {talk !== '' ? (
          <span className="text-[12px] leading-4 text-muted-foreground">{talk}</span>
        ) : null}
      </span>
    </Link>
  )
}

function SpeakerPhoto({
  photo,
  name,
  initials,
  compact = false,
}: {
  readonly photo: string | null
  readonly name: string
  readonly initials: string
  readonly compact?: boolean
}) {
  return (
    <span
      className={cn(
        'overflow-hidden bg-muted',
        compact ? 'size-10 shrink-0 rounded-md' : 'h-[220px] w-full rounded-lg',
      )}
    >
      {photo !== null ? (
        <img src={photo} alt={name} className="size-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-full items-center justify-center text-sm font-medium text-muted-foreground"
        >
          {initials}
        </span>
      )}
    </span>
  )
}
