import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { ButtonGroup } from '../../../components/ui/button-group'
import { Checkbox } from '../../../components/ui/checkbox'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '../../../components/ui/input-group'
import { NativeSelect } from '../../../components/ui/native-select'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Textarea } from '../../../components/ui/textarea'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { requestJson } from '../../api/admin-events'
import { speakerQueryKeys, useSpeakerRoster } from '../../queries/admin-speakers'
import type { EventSlug } from '../../../domain'
import type { SpeakerRosterEntryDto } from '../../../application'
import { useProgrammeSpotlight } from './useProgrammeSpotlight'

async function loadCsvText(file: File): Promise<string> {
  return file.text()
}

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
  const client = useQueryClient()
  const [term, setTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [taskFilter, setTaskFilter] = useState('all')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [bio, setBio] = useState('')
  const [csv, setCsv] = useState('')
  const onCsvChosen = async (file: File | undefined) => {
    if (file === undefined) return
    setCsv(await loadCsvText(file))
  }
  const add = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${eventSlug}/speakers`, {
        method: 'POST',
        body: JSON.stringify({ name, email, bio }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: speakerQueryKeys.roster(eventSlug) })
      setName('')
      setEmail('')
      setBio('')
    },
  })
  const importCsv = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${eventSlug}/speakers/import`, {
        method: 'POST',
        body: JSON.stringify({ csv }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: speakerQueryKeys.roster(eventSlug) })
    },
  })

  useEffect(() => {
    document.title = 'Speakers — Open Events'
  }, [])

  // Memoised so the fallback is not a fresh array on every render, which would
  // make the filter below recompute for no reason.
  const people = useMemo(() => roster.data ?? [], [roster.data])
  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase()
    return people.filter((person) => {
      if (statusFilter !== 'all' && person.workflowStatus !== statusFilter) return false
      if (taskFilter === 'complete' && person.outstandingTaskCount > 0) return false
      if (taskFilter === 'incomplete' && person.outstandingTaskCount === 0) return false
      if (needle === '') return true
      return (
        person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle)
      )
    })
  }, [people, term, statusFilter, taskFilter])
  const { spotlightId, select } = useProgrammeSpotlight(matches.map((person) => person.contactId))
  const selected = matches.find((person) => person.contactId === spotlightId) ?? matches[0] ?? null

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

      <div
        data-slot="speakers-canvas"
        data-spotlight={selected?.contactId ?? undefined}
        className="flex flex-col gap-4 xl:flex-row xl:items-start"
      >
        <div data-slot="speakers-roster" className="grid min-w-0 w-full max-w-3xl gap-4">
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
              <div className="flex flex-wrap items-end gap-3">
                <Field className="max-w-sm">
                  <FieldLabel htmlFor="speaker-search">Search speakers</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText>Find</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id="speaker-search"
                      type="search"
                      value={term}
                      placeholder="Name or email"
                      onChange={(event) => setTerm(event.target.value)}
                    />
                  </InputGroup>
                </Field>
                <Field className="max-w-xs">
                  <FieldLabel htmlFor="speaker-status-filter">Filter by status</FieldLabel>
                  <NativeSelect
                    id="speaker-status-filter"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="invited">Invited</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="accepted">Accepted</option>
                    <option value="declined">Declined</option>
                  </NativeSelect>
                </Field>
                <Field className="max-w-xs">
                  <FieldLabel htmlFor="speaker-task-filter">Filter by task completion</FieldLabel>
                  <NativeSelect
                    id="speaker-task-filter"
                    value={taskFilter}
                    onChange={(event) => setTaskFilter(event.target.value)}
                  >
                    <option value="all">All task progress</option>
                    <option value="complete">Tasks complete</option>
                    <option value="incomplete">Outstanding tasks</option>
                  </NativeSelect>
                </Field>
              </div>

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
                <div className="grid gap-3">
                  <ul className="grid gap-2" aria-label="Speakers">
                    {matches.map((person) => (
                      <SpeakerRow
                        key={person.contactId}
                        person={person}
                        eventSlug={eventSlug}
                        selected={selected?.contactId === person.contactId}
                        onSelect={() => select(person.contactId)}
                      />
                    ))}
                  </ul>
                  {selected !== null ? <SpeakerPeek person={selected} /> : null}
                </div>
              )}
            </>
          )}
        </div>
        <aside
          data-slot="speakers-rail"
          aria-label="Add and import speakers"
          className="grid w-full shrink-0 gap-4 xl:sticky xl:top-16 xl:w-[22rem]"
        >
          <Card>
            <CardHeader className="border-b">
              <CardTitle level={2}>Add speaker</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  add.mutate()
                }}
              >
                <Field>
                  <FieldLabel htmlFor="add-speaker-name">Add speaker name</FieldLabel>
                  <Input
                    id="add-speaker-name"
                    value={name}
                    onChange={(change) => setName(change.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="add-speaker-email">Email</FieldLabel>
                  <Input
                    id="add-speaker-email"
                    value={email}
                    onChange={(change) => setEmail(change.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="add-speaker-bio">Bio</FieldLabel>
                  <Input
                    id="add-speaker-bio"
                    value={bio}
                    onChange={(change) => setBio(change.target.value)}
                  />
                </Field>
                <Button type="submit" className="self-start" pending={add.isPending}>
                  Add speaker
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b">
              <CardTitle level={2}>Import</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Field>
                <FieldLabel htmlFor="speaker-csv-file">Import speakers CSV file</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <label
                      htmlFor="speaker-csv-file"
                      className="cursor-pointer font-medium text-foreground"
                    >
                      Choose CSV
                    </label>
                  </InputGroupAddon>
                  <input
                    id="speaker-csv-file"
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(change) => {
                      void onCsvChosen(change.target.files?.[0])
                    }}
                  />
                  <InputGroupText>
                    {csv.length > 0 ? 'CSV loaded' : 'No file chosen'}
                  </InputGroupText>
                </InputGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="speaker-csv">Import CSV</FieldLabel>
                <Textarea
                  id="speaker-csv"
                  className="min-h-24 font-mono text-sm md:text-sm"
                  value={csv}
                  onChange={(change) => setCsv(change.target.value)}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                className="self-start"
                pending={importCsv.isPending}
                onClick={() => importCsv.mutate()}
              >
                Import speakers
              </Button>
            </CardContent>
          </Card>
          <AssignmentForm eventSlug={eventSlug} people={people} />
          <FormTaskAssign eventSlug={eventSlug} people={people} />
          <SpeakerMailForm eventSlug={eventSlug} people={people} />
        </aside>
      </div>
    </div>
  )
}

function SpeakerPeek({ person }: { readonly person: SpeakerRosterEntryDto }) {
  return (
    <Card data-slot="speakers-peek" className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle level={2}>{person.name || person.email}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <p>{person.email}</p>
        <p className="text-muted-foreground">
          {person.workflowStatus} · {person.outstandingTaskCount} outstanding
        </p>
      </CardContent>
    </Card>
  )
}

function SpeakerRow({
  person,
  eventSlug,
  selected,
  onSelect,
}: {
  readonly person: SpeakerRosterEntryDto
  readonly eventSlug: EventSlug
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const client = useQueryClient()
  const status = useMutation({
    mutationFn: (workflowStatus: string) =>
      requestJson(`/api/admin/events/${eventSlug}/speakers/${person.contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ workflowStatus }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: speakerQueryKeys.roster(eventSlug) })
    },
  })
  const invite = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${eventSlug}/speakers/${person.contactId}/invite`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: speakerQueryKeys.roster(eventSlug) })
    },
  })
  return (
    <li
      data-selected={selected ? '' : undefined}
      className="grid gap-2 rounded-md border border-border px-3 py-2"
      onClick={onSelect}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="grid min-w-0">
          <span className="truncate text-sm font-medium">{person.name || person.email}</span>
          <span className="truncate text-xs text-muted-foreground">
            {person.email}
            {person.jobTitle !== '' ? ` · ${person.jobTitle}` : ''}
            {person.company !== '' ? ` · ${person.company}` : ''}
          </span>
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
          <Badge dot variant={person.profileComplete ? 'secondary' : 'outline'}>
            {person.profileComplete ? 'Profile complete' : 'Profile incomplete'}
          </Badge>
          <label className="flex items-center gap-1 text-xs">
            Status
            <NativeSelect
              aria-label={`Status for ${person.name || person.email}`}
              className="h-7 w-auto min-w-28"
              value={person.workflowStatus}
              onChange={(event) => status.mutate(event.target.value)}
            >
              <option value="invited">Invited</option>
              <option value="confirmed">Confirmed</option>
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
            </NativeSelect>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            pending={invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isSuccess ? 'Invite sent' : 'Send invite'}
          </Button>
        </span>
      </div>
      <SpeakerProfileEditor eventSlug={eventSlug} person={person} />
    </li>
  )
}

function SpeakerProfileEditor({
  eventSlug,
  person,
}: {
  readonly eventSlug: EventSlug
  readonly person: SpeakerRosterEntryDto
}) {
  const client = useQueryClient()
  const [bio, setBio] = useState<string | null>(null)
  const [jobTitle, setJobTitle] = useState<string | null>(null)
  const [company, setCompany] = useState<string | null>(null)
  const [travelNotes, setTravelNotes] = useState<string | null>(null)
  const bioValue = bio ?? person.bio ?? ''
  const jobTitleValue = jobTitle ?? person.jobTitle
  const companyValue = company ?? person.company
  const travelNotesValue = travelNotes ?? person.travelNotes
  const save = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${eventSlug}/speakers/${person.contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          bio: bioValue,
          jobTitle: jobTitleValue,
          company: companyValue,
          travelNotes: travelNotesValue,
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: speakerQueryKeys.roster(eventSlug) })
    },
  })
  const headshot = useMutation({
    mutationFn: async (file: File) => {
      const response = await fetch(
        `/api/admin/events/${eventSlug}/speakers/${person.contactId}/headshot`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': file.type || 'image/png' },
          body: file,
        },
      )
      if (!response.ok) throw new Error('headshot upload failed')
      return response.json()
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: speakerQueryKeys.roster(eventSlug) })
    },
  })
  return (
    <form
      className="grid gap-2 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <Field>
        <FieldLabel htmlFor={`bio-${person.contactId}`}>Bio</FieldLabel>
        <Input
          id={`bio-${person.contactId}`}
          value={bioValue}
          onChange={(change) => setBio(change.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`title-${person.contactId}`}>Job title</FieldLabel>
        <Input
          id={`title-${person.contactId}`}
          value={jobTitleValue}
          onChange={(change) => setJobTitle(change.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`company-${person.contactId}`}>Company</FieldLabel>
        <Input
          id={`company-${person.contactId}`}
          value={companyValue}
          onChange={(change) => setCompany(change.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`travel-${person.contactId}`}>Travel / logistics</FieldLabel>
        <Input
          id={`travel-${person.contactId}`}
          value={travelNotesValue}
          onChange={(change) => setTravelNotes(change.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`headshot-${person.contactId}`}>Headshot</FieldLabel>
        <input
          id={`headshot-${person.contactId}`}
          type="file"
          aria-label="Headshot"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) headshot.mutate(file)
          }}
        />
      </Field>
      <div className="flex items-end">
        <Button type="submit" size="sm" pending={save.isPending}>
          {save.isSuccess ? 'Profile saved' : 'Save profile'}
        </Button>
      </div>
    </form>
  )
}

function FormTaskAssign({
  eventSlug,
  people,
}: {
  readonly eventSlug: EventSlug
  readonly people: readonly SpeakerRosterEntryDto[]
}) {
  const [formId, setFormId] = useState('')
  const [submissionId, setSubmissionId] = useState('')
  const [contactId, setContactId] = useState('')
  const forms = useQuery({
    queryKey: ['admin', 'forms', eventSlug],
    queryFn: () =>
      requestJson<readonly { formId: string; slug: string; publishedVersionId: string | null }[]>(
        `/api/admin/events/${eventSlug}/forms`,
      ),
  })
  const submissions = useQuery({
    queryKey: ['admin', 'events', eventSlug, 'submissions'],
    queryFn: () =>
      requestJson<
        readonly {
          id: string
          title: string
          decision: string
          primarySpeaker: { contactId: string }
        }[]
      >(`/api/admin/events/${eventSlug}/submissions`),
  })
  const published = (forms.data ?? []).filter((form) => form.publishedVersionId !== null)
  const accepted = (submissions.data ?? []).filter((row) => row.decision === 'accepted')
  const assign = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${eventSlug}/submissions/${submissionId}/form-tasks`, {
        method: 'POST',
        body: JSON.stringify({ formId, contactId }),
      }),
  })
  return (
    <section className="grid gap-2" aria-labelledby="form-task-heading">
      <h2 id="form-task-heading" className="text-lg font-medium">
        Assign a published form
      </h2>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          assign.mutate()
        }}
      >
        <Field>
          <FieldLabel htmlFor="form-task-form">Published form</FieldLabel>
          <NativeSelect
            id="form-task-form"
            value={formId}
            onChange={(change) => setFormId(change.target.value)}
          >
            <option value="">Select a form</option>
            {published.map((form) => (
              <option key={form.formId} value={form.formId}>
                {form.slug}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="form-task-submission">Accepted proposal</FieldLabel>
          <NativeSelect
            id="form-task-submission"
            value={submissionId}
            onChange={(change) => setSubmissionId(change.target.value)}
          >
            <option value="">Select a proposal</option>
            {accepted.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="form-task-speaker">Speaker</FieldLabel>
          <NativeSelect
            id="form-task-speaker"
            value={contactId}
            onChange={(change) => setContactId(change.target.value)}
          >
            <option value="">Select a speaker</option>
            {people.map((person) => (
              <option key={person.contactId} value={person.contactId}>
                {person.name || person.email}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button
          type="submit"
          className="self-start"
          pending={assign.isPending}
          disabled={formId === '' || submissionId === '' || contactId === ''}
        >
          {assign.isSuccess ? 'Form assigned' : 'Assign form'}
        </Button>
      </form>
    </section>
  )
}

function AssignmentForm({
  eventSlug,
  people,
}: {
  readonly eventSlug: EventSlug
  readonly people: readonly SpeakerRosterEntryDto[]
}) {
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [kind, setKind] = useState('general')
  const [instructions, setInstructions] = useState('')
  const [assigneeOverride, setAssigneeOverride] = useState<readonly string[] | null>(null)
  const assignees = assigneeOverride ?? people.map((person) => person.contactId)
  const tasks = useQuery({
    queryKey: ['admin', 'assignments', eventSlug],
    queryFn: () =>
      requestJson<
        readonly {
          id: string
          title: string
          dueAt: string | null
          kind: string
          instructions: string
          assignees: readonly { contactId: string; status: string }[]
        }[]
      >(`/api/admin/events/${eventSlug}/assignments`),
  })
  const create = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${eventSlug}/assignments`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          dueAt: dueAt === '' ? null : dueAt,
          kind,
          instructions,
          contactIds: assignees,
        }),
      }),
    onSuccess: () => {
      void tasks.refetch()
    },
  })
  return (
    <section className="grid gap-2" aria-labelledby="assignment-heading">
      <h2 id="assignment-heading" className="text-lg font-medium">
        Assigned tasks
      </h2>
      <ul aria-label="Assigned tasks" className="grid gap-1 text-sm">
        {(tasks.data ?? []).map((task) => (
          <li key={task.id}>
            {task.title} · due {task.dueAt ?? 'none'} · {task.kind} · {task.assignees.length}{' '}
            assignee(s)
            {task.instructions !== '' ? ` · ${task.instructions}` : ''}
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Field>
          <FieldLabel htmlFor="assignment-title">Assign a task</FieldLabel>
          <Input
            id="assignment-title"
            value={title}
            onChange={(change) => setTitle(change.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="assignment-instructions">Instructions</FieldLabel>
          <Input
            id="assignment-instructions"
            value={instructions}
            onChange={(change) => setInstructions(change.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="assignment-due">Due date</FieldLabel>
          <Input
            id="assignment-due"
            type="date"
            value={dueAt}
            onChange={(change) => setDueAt(change.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="assignment-kind">Task type</FieldLabel>
          <NativeSelect
            id="assignment-kind"
            value={kind}
            onChange={(change) => setKind(change.target.value)}
          >
            <option value="general">General</option>
            <option value="file_request">File request</option>
          </NativeSelect>
        </Field>
        <fieldset className="grid gap-1">
          <legend className="text-sm font-medium">Assign to speakers</legend>
          {people.map((person) => (
            <label key={person.contactId} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={assignees.includes(person.contactId)}
                onChange={(event) => {
                  setAssigneeOverride(
                    event.target.checked
                      ? [...assignees, person.contactId]
                      : assignees.filter((id) => id !== person.contactId),
                  )
                }}
              />
              {person.name || person.email}
            </label>
          ))}
        </fieldset>
        <Button type="submit" className="self-start" pending={create.isPending}>
          {create.isSuccess ? 'Task assigned' : 'Assign task'}
        </Button>
      </form>
    </section>
  )
}

function SpeakerMailForm({
  eventSlug,
  people,
}: {
  readonly eventSlug: EventSlug
  readonly people: readonly SpeakerRosterEntryDto[]
}) {
  const templates = useQuery({
    queryKey: ['admin', 'speaker-templates', eventSlug],
    queryFn: () =>
      requestJson<readonly { id: string; name: string; subject: string; body: string }[]>(
        `/api/admin/events/${eventSlug}/speakers/templates`,
      ),
  })
  const history = useQuery({
    queryKey: ['admin', 'messages', eventSlug],
    queryFn: () =>
      requestJson<readonly { toEmail: string; subject: string; createdAt: string }[]>(
        `/api/admin/events/${eventSlug}/messages`,
      ),
  })
  const first = templates.data?.[0]
  const [subject, setSubject] = useState(first?.subject ?? 'Welcome to {{eventName}} speakers')
  const [body, setBody] = useState(first?.body ?? 'Hi {{name}},\n\nWelcome to {{eventName}}.')
  const [selectedOverride, setSelectedOverride] = useState<readonly string[] | null>(null)
  const selected = selectedOverride ?? people.map((person) => person.contactId)
  const preview = useMutation({
    mutationFn: () =>
      requestJson<{ subject: string; body: string; recipientCount: number }>(
        `/api/admin/events/${eventSlug}/speakers/broadcast`,
        {
          method: 'POST',
          body: JSON.stringify({ subject, body, contactIds: selected, preview: true }),
        },
      ),
  })
  const send = useMutation({
    mutationFn: (contactIds: readonly string[]) =>
      requestJson(`/api/admin/events/${eventSlug}/speakers/broadcast`, {
        method: 'POST',
        body: JSON.stringify({ subject, body, contactIds }),
      }),
    onSuccess: () => {
      void history.refetch()
    },
  })
  const outstandingIds = people
    .filter((person) => person.outstandingTaskCount > 0)
    .map((person) => person.contactId)
  return (
    <section className="grid max-w-xl gap-2" aria-labelledby="speaker-mail-heading">
      <h2 id="speaker-mail-heading" className="text-lg font-medium">
        Bulk email
      </h2>
      <Field>
        <FieldLabel htmlFor="mail-template">Template</FieldLabel>
        <NativeSelect
          id="mail-template"
          onChange={(event) => {
            const template = templates.data?.find((row) => row.id === event.target.value)
            if (template === undefined) return
            setSubject(template.subject)
            setBody(template.body)
          }}
        >
          {(templates.data ?? []).map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="mail-subject">Subject</FieldLabel>
        <Input
          id="mail-subject"
          value={subject}
          onChange={(change) => setSubject(change.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="mail-body">Body</FieldLabel>
        <Textarea id="mail-body" value={body} onChange={(change) => setBody(change.target.value)} />
      </Field>
      <fieldset className="grid gap-1">
        <legend className="text-sm font-medium">Recipients</legend>
        {people.map((person) => (
          <label key={person.contactId} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(person.contactId)}
              onChange={(event) => {
                setSelectedOverride(
                  event.target.checked
                    ? [...selected, person.contactId]
                    : selected.filter((id) => id !== person.contactId),
                )
              }}
            />
            {person.name || person.email}
          </label>
        ))}
      </fieldset>
      <ButtonGroup className="flex-wrap">
        <Button
          type="button"
          variant="outline"
          pending={preview.isPending}
          onClick={() => preview.mutate()}
        >
          Preview
        </Button>
        <Button type="button" pending={send.isPending} onClick={() => send.mutate(selected)}>
          {send.isSuccess ? 'Email sent' : 'Send to selected speakers'}
        </Button>
        <Button
          type="button"
          variant="outline"
          pending={send.isPending}
          onClick={() => {
            setSelectedOverride(outstandingIds)
            send.mutate(outstandingIds)
          }}
        >
          Send reminder to speakers with outstanding tasks
        </Button>
      </ButtonGroup>
      {preview.data !== undefined ? (
        <pre className="overflow-auto rounded-md border border-border p-2 text-xs">
          {`${preview.data.subject}\n\n${preview.data.body}`}
        </pre>
      ) : null}
      <h3 className="text-sm font-medium">Communications history</h3>
      <ul aria-label="Communications history" className="grid gap-1 text-sm">
        {(history.data ?? []).map((row) => (
          <li key={`${row.toEmail}-${row.createdAt}`}>
            {row.createdAt} · {row.toEmail} · {row.subject}
          </li>
        ))}
      </ul>
    </section>
  )
}
