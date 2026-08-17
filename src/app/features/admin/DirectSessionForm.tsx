import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { Textarea } from '../../../components/ui/textarea'
import { createDirectSession } from '../../api/admin-agenda'
import { adminAgendaQueryKeys } from '../../queries/admin-agenda'
import { useTaxonomies } from '../../queries/admin-events'
import { speakerQueryKeys, useSpeakerRoster } from '../../queries/admin-speakers'

export default function DirectSessionForm({ eventSlug }: { readonly eventSlug: string }) {
  const [open, setOpen] = useState(false)
  if (open) return <DirectSessionFields eventSlug={eventSlug} onClose={() => setOpen(false)} />
  return (
    <Card data-tour="direct-session-form">
      <CardHeader className="border-b">
        <CardTitle level={2}>Invited sessions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Add a keynote, sponsor talk, or other guaranteed session without sending it through
          review.
        </p>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Add invited session
        </Button>
      </CardContent>
    </Card>
  )
}

function DirectSessionFields({
  eventSlug,
  onClose,
}: {
  readonly eventSlug: string
  readonly onClose: () => void
}) {
  const client = useQueryClient()
  const speakers = useSpeakerRoster(eventSlug)
  const taxonomies = useTaxonomies(eventSlug)
  const requestId = useRef<string | null>(null)
  const [speakerContactId, setSpeakerContactId] = useState('')
  const [title, setTitle] = useState('')
  const [abstract, setAbstract] = useState('')
  const [formatId, setFormatId] = useState('')
  const [trackId, setTrackId] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('45')
  const [notes, setNotes] = useState('')
  const create = useMutation({
    mutationFn: () => {
      requestId.current ??= crypto.randomUUID()
      return createDirectSession(eventSlug, {
        requestId: requestId.current,
        speakerContactId,
        title,
        abstract,
        formatId,
        trackId: trackId === '' ? null : trackId,
        durationMinutes: Number(durationMinutes),
        notes,
      })
    },
    onSuccess: () => {
      requestId.current = null
      setTitle('')
      setAbstract('')
      setNotes('')
      void client.invalidateQueries({ queryKey: adminAgendaQueryKeys.board(eventSlug) })
      void client.invalidateQueries({ queryKey: speakerQueryKeys.roster(eventSlug) })
      void client.invalidateQueries({ queryKey: ['admin', 'events', eventSlug, 'readiness'] })
    },
  })
  const people = speakers.data ?? []
  const formats = (taxonomies.data?.items ?? []).filter((item) => item.kind === 'format')
  const tracks = (taxonomies.data?.items ?? []).filter((item) => item.kind === 'track')

  return (
    <Card data-tour="direct-session-form">
      <CardHeader className="border-b">
        <CardTitle level={2}>Add invited session</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 lg:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <Field>
            <FieldLabel htmlFor="direct-session-speaker">Speaker</FieldLabel>
            <NativeSelect
              id="direct-session-speaker"
              required
              value={speakerContactId}
              onChange={(event) => setSpeakerContactId(event.target.value)}
            >
              <option value="">Choose a speaker</option>
              {people.map((speaker) => (
                <option key={speaker.contactId} value={speaker.contactId}>
                  {speaker.name || speaker.email}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="direct-session-title">Title</FieldLabel>
            <Input
              id="direct-session-title"
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field className="lg:col-span-2">
            <FieldLabel htmlFor="direct-session-abstract">Abstract</FieldLabel>
            <Textarea
              id="direct-session-abstract"
              required
              maxLength={5_000}
              value={abstract}
              onChange={(event) => setAbstract(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="direct-session-format">Format</FieldLabel>
            <NativeSelect
              id="direct-session-format"
              required
              value={formatId}
              onChange={(event) => setFormatId(event.target.value)}
            >
              <option value="">Choose a format</option>
              {formats.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="direct-session-track">Track</FieldLabel>
            <NativeSelect
              id="direct-session-track"
              value={trackId}
              onChange={(event) => setTrackId(event.target.value)}
            >
              <option value="">No track yet</option>
              {tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="direct-session-duration">Duration in minutes</FieldLabel>
            <Input
              id="direct-session-duration"
              type="number"
              min={15}
              max={240}
              step={5}
              required
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="direct-session-notes">Organizer notes</FieldLabel>
            <Input
              id="direct-session-notes"
              maxLength={2_000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <div className="grid gap-2 lg:col-span-2">
            {people.length === 0 && !speakers.isPending ? (
              <AlertLive>Add a speaker from the Speakers desk before creating a session.</AlertLive>
            ) : null}
            {create.isError ? (
              <AlertLive>
                Could not create this invited session. Check the fields and try again.
              </AlertLive>
            ) : null}
            {create.isSuccess ? (
              <p className="text-sm text-muted-foreground">
                {create.data.created
                  ? 'Invited session created and added to the unplaced agenda.'
                  : 'That invited session was already created.'}
              </p>
            ) : null}
            <Button
              type="submit"
              className="justify-self-start"
              pending={create.isPending}
              disabled={people.length === 0 || formats.length === 0}
            >
              Create invited session
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-self-start"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
