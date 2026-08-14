import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useParams } from '@tanstack/react-router'

import { Avatar, AvatarFallback } from '../../../components/ui/avatar'
import { Card, CardContent } from '../../../components/ui/card'
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
import { usePublicSpeakers, type PublicSpeaker } from '../../queries/public-speakers'

export default function PublicSpeakersPage({ gallery = false }: { readonly gallery?: boolean }) {
  const params = useParams({ strict: false })
  const eventSlug = params.eventSlug as string | undefined
  const query = usePublicSpeakers(eventSlug)
  const [term, setTerm] = useState('')
  const [mode, setMode] = useState<'list' | 'gallery'>(gallery ? 'gallery' : 'list')

  useEffect(() => {
    document.title = gallery ? 'Speaker gallery — Open Events' : 'Speakers — Open Events'
  }, [gallery])

  const people = useMemo(() => query.data ?? [], [query.data])
  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (needle === '') return people
    return people.filter((person) =>
      `${person.name} ${person.jobTitle} ${person.company}`.toLowerCase().includes(needle),
    )
  }, [people, term])
  if (params.contactId !== undefined) return <Outlet />

  return (
    <div className="grid gap-4">
      <PageHeader surface="wash">
        <PageHeaderContent>
          <PageHeaderTitle>{gallery ? 'Speaker gallery' : 'Speakers'}</PageHeaderTitle>
          <PageHeaderDescription>
            Published speakers, ordered by surname. Missing photos fall back to initials.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <Card>
        <CardContent className="grid gap-3">
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
          <Field>
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
        </CardContent>
      </Card>
      <StatusLive>
        {shown.length} of {people.length} speaker{people.length === 1 ? '' : 's'} shown.
      </StatusLive>
      {shown.length === 0 ? (
        <EmptyState title="No speakers match" description="Try another name." />
      ) : (
        <div
          className={mode === 'gallery' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3' : 'grid gap-3'}
        >
          {shown.map((person) => (
            <SpeakerCard key={person.id} person={person} eventSlug={eventSlug ?? ''} />
          ))}
        </div>
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

function SpeakerCard({
  person,
  eventSlug,
}: {
  readonly person: PublicSpeaker
  readonly eventSlug: string
}) {
  const photo =
    person.photoUrl ??
    (person.hasHeadshot ? `/api/public/events/${eventSlug}/speakers/${person.id}/headshot` : null)
  return (
    <Card>
      <CardContent className="grid gap-2">
        <Avatar className="size-16">
          {photo !== null ? (
            <img
              src={photo}
              alt={person.name}
              className="aspect-square size-full rounded-full object-cover"
            />
          ) : (
            <AvatarFallback>{speakerInitials(person.name) || '?'}</AvatarFallback>
          )}
        </Avatar>
        <Link
          to="/speakers/$eventSlug/$contactId"
          params={{ eventSlug, contactId: person.id }}
          className="font-medium underline"
        >
          {person.name}
        </Link>
        <p className="text-sm text-muted-foreground">
          {person.jobTitle}
          {person.jobTitle !== '' && person.company !== '' ? ' · ' : ''}
          {person.company}
        </p>
        {person.bio !== '' ? <p className="whitespace-pre-wrap text-sm">{person.bio}</p> : null}
      </CardContent>
    </Card>
  )
}
