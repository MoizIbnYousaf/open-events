import { useEffect, useMemo, useState } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { useSpeakerRoster } from '../../queries/admin-speakers'
import type { EventSlug } from '../../../domain'
import type { SpeakerRosterEntryDto } from '../../../application'

/**
 * Who is on the programme, and what each of them still owes.
 *
 * The organizer could see every proposal and not one speaker. Everything a
 * speaker does — writing a bio, uploading a headshot, finishing an onboarding
 * task — landed in a database nobody had a screen for, so the only way to
 * answer "who still owes me a headshot" was to open proposals one at a time.
 */
export default function SpeakersPage({ eventSlug }: { readonly eventSlug: EventSlug }) {
  const roster = useSpeakerRoster(eventSlug)
  const [term, setTerm] = useState('')

  useEffect(() => {
    document.title = 'Speakers — Open Events'
  }, [])

  // Memoised so the fallback is not a fresh array on every render, which would
  // make the filter below recompute for no reason.
  const people = useMemo(() => roster.data ?? [], [roster.data])
  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (needle === '') return people
    // Name AND email, because an organizer looking for someone has whichever
    // of the two they were given.
    return people.filter(
      (person) =>
        person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle),
    )
  }, [people, term])

  return (
    <div className="grid gap-4">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Speakers</PageHeaderTitle>
          <PageHeaderDescription>
            Everyone on this programme, and what each of them still owes.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      {roster.isError ? <AlertLive>The speaker list is unavailable right now.</AlertLive> : null}

      {roster.isPending ? (
        <div aria-busy="true" className="grid gap-2">
          <StatusLive>Loading the speakers…</StatusLive>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : people.length === 0 ? (
        <EmptyState
          title="No speakers yet"
          description="Anyone named on a proposal appears here — the submitter and every co-speaker."
        />
      ) : (
        <>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="speaker-search">Search speakers</FieldLabel>
            <Input
              id="speaker-search"
              type="search"
              value={term}
              placeholder="Name or email"
              onChange={(event) => setTerm(event.target.value)}
            />
          </Field>

          {/* The count is announced, so filtering is legible to someone who
              cannot see the list shrink. */}
          <StatusLive aria-live="polite">
            {`${matches.length} of ${people.length} speaker(s) shown.`}
          </StatusLive>

          {matches.length === 0 ? (
            <EmptyState
              title="Nobody matches that"
              description="Try part of a name or an email address."
            />
          ) : (
            <ul className="grid gap-2" aria-label="Speakers">
              {matches.map((person) => (
                <SpeakerRow key={person.contactId} person={person} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function SpeakerRow({ person }: { readonly person: SpeakerRosterEntryDto }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <span className="grid min-w-0">
        <span className="truncate text-sm font-medium">{person.name || person.email}</span>
        <span className="truncate text-xs text-muted-foreground">{person.email}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{`${person.proposalCount} proposal(s)`}</Badge>
        {person.sessionCount > 0 ? (
          <Badge variant="outline">{`${person.sessionCount} session(s)`}</Badge>
        ) : null}
        {person.taskCount > 0 ? (
          <Badge variant="outline">
            {`${person.taskCompletedCount} of ${person.taskCount} tasks done`}
          </Badge>
        ) : null}
        {/* A profile is complete only with both halves. Chasing one without the
            other is how somebody gets asked twice for what they already sent. */}
        <Badge dot variant={person.profileComplete ? 'secondary' : 'outline'}>
          {person.profileComplete ? 'Profile complete' : 'Profile incomplete'}
        </Badge>
      </span>
    </li>
  )
}
