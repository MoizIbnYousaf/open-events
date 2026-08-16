import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { DocumentStackIcon } from '../../../components/ui/icons'
import { TextLink } from '../../../components/ui/link'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { Textarea } from '../../../components/ui/textarea'
import type { SubmissionDetailDto } from '../../../application'
import { getApiErrorCode, getApiErrorMessage, requestJson } from '../../api/admin-events'
import { RoleLinkRequiredState } from '../admin/AdminStates'
import {
  resolveDecision,
  useEditOwnSubmission,
  useOwnSubmission,
  useOwnSubmissions,
  type PortalSubmission,
  type SubmissionOutcome,
} from '../../queries/portal'
import DocumentUploader from './DocumentUploader'
import HeadshotUploader from './HeadshotUploader'
import ProfileEditor from './ProfileEditor'
import TasksPanel from './TasksPanel'

interface PortalPageProps {
  /** Called once when the API reports no session; the route sends them to /start. */
  readonly onUnauthenticated: () => void
}

const HEADING = 'Speaker portal'
const SUBHEADING = 'Your proposals, your onboarding tasks and the profile organizers see.'

/** The measure the whole speaker journey reads at. */
const COLUMN = 'mx-auto grid w-full max-w-[64rem] gap-5'

/**
 * REQ-006 speaker portal: the signed-in speaker's own submissions. The page
 * owns an h1 in every state, announces loading politely, keeps error copy
 * generic with a working retry, and renders a real empty state.
 */
export default function PortalPage({ onUnauthenticated }: PortalPageProps) {
  const query = useOwnSubmissions()
  const data = query.data
  const unauthenticated = data === null

  useEffect(() => {
    document.title = 'Speaker portal — Open Events'
  }, [])

  useEffect(() => {
    if (unauthenticated) onUnauthenticated()
  }, [unauthenticated, onUnauthenticated])

  if (unauthenticated) {
    return (
      <div className={COLUMN}>
        <Header />
        <Card>
          <CardContent>
            <StatusLive aria-live="polite">Taking you to the sign-in step…</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (query.isError) {
    // A signed-in identity the portal will not serve is a different answer
    // from an expired one, and it was previously indistinguishable from a
    // transient failure with a retry that could only fail the same way.
    if (getApiErrorCode(query.error) === 'forbidden') {
      return <RoleLinkRequiredState role="portal" />
    }
    return (
      <div className={COLUMN}>
        <Header />
        <Card>
          <CardContent className="grid justify-items-start gap-3">
            <AlertLive>Your submissions are unavailable right now.</AlertLive>
            <Button
              type="button"
              variant="outline"
              pending={query.isFetching}
              onClick={() => {
                void query.refetch()
              }}
            >
              {query.isFetching ? 'Trying again…' : 'Try again'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (data === undefined) {
    return (
      <div className={COLUMN} aria-busy={query.isPending}>
        <Header />
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-10 w-full" />
            <StatusLive aria-live="polite">Loading your submissions…</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Owning a submission is NOT the condition for onboarding: acceptance
  // materialises a checklist for every contributor, so a co-speaker signs in
  // with an empty own-list and still has tasks and a headshot to upload. The
  // checklist and the uploader therefore sit outside the empty branch.
  return (
    <div className={COLUMN} data-tour="speaker-portal">
      <Header />
      <PortalOverview submissions={data} />
      <PortalSections />
      <section id="portal-proposals" className="scroll-mt-24">
        {data.length === 0 ? (
          <EmptyState
            icon={<DocumentStackIcon size={20} />}
            title="Submit your first proposal"
            description="No submissions yet. Proposals you submit appear here; any onboarding tasks assigned to you are listed below."
          />
        ) : (
          <Card>
            <ul aria-label="Your submissions" className="divide-y divide-border">
              {data.map((submission) => (
                <li
                  key={submission.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
                >
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm font-medium">{submission.title}</span>
                    <InviteLink submission={submission} />
                  </div>
                  <ProposalDisclosure
                    submission={submission}
                    onUnauthenticated={onUnauthenticated}
                  />
                  <DecisionBadge decision={resolveDecision(submission)} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      <div id="portal-tasks" className="grid scroll-mt-24 gap-5 lg:grid-cols-2">
        <TasksPanel />
        <AssignmentsPanel />
      </div>
      <div id="portal-profile" className="scroll-mt-24">
        <ProfileEditor />
      </div>
      <div id="portal-files" className="grid scroll-mt-24 gap-5 lg:grid-cols-2">
        <HeadshotUploader />
        <DocumentUploader />
      </div>
    </div>
  )
}

function PortalOverview({ submissions }: { readonly submissions: readonly PortalSubmission[] }) {
  const accepted = submissions.filter((submission) => resolveDecision(submission) === 'accepted')
  return (
    <section role="region" aria-label="Portal overview" className="grid gap-2 sm:grid-cols-3">
      <PortalFact
        label="Proposals"
        value={`${submissions.length} proposal${submissions.length === 1 ? '' : 's'}`}
      />
      <PortalFact label="Accepted" value={`${accepted.length} accepted`} />
      <PortalFact
        label="Next up"
        value={accepted.length > 0 ? 'Onboarding is ready' : 'Awaiting a programme decision'}
      />
    </section>
  )
}

function PortalFact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Card>
      <CardContent className="grid gap-0.5 py-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{value}</span>
      </CardContent>
    </Card>
  )
}

function PortalSections() {
  return (
    <nav
      aria-label="Speaker portal sections"
      className="flex flex-wrap gap-1 rounded-lg border bg-muted/20 p-1"
    >
      {[
        ['Proposals', '#portal-proposals'],
        ['Tasks', '#portal-tasks'],
        ['Profile', '#portal-profile'],
        ['Files', '#portal-files'],
      ].map(([label, href]) => (
        <a
          key={href}
          href={href}
          className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </a>
      ))}
    </nav>
  )
}

/** The page heading, identical in every state so the page never loses its h1. */
function Header() {
  return (
    <PageHeader surface="wash">
      <PageHeaderContent>
        <PageHeaderTitle>{HEADING}</PageHeaderTitle>
        <PageHeaderDescription>{SUBHEADING}</PageHeaderDescription>
      </PageHeaderContent>
    </PageHeader>
  )
}

/**
 * The way back into a proposal a speaker already sent.
 *
 * The row used to be inert: a title, a status chip, and no path to the words
 * underneath — so a typo in an abstract was permanent and the only "edit" a
 * speaker could attempt was submitting the whole thing again. Opening the row
 * fetches the full proposal and, while the call is still open, lets them revise
 * it in place.
 *
 * Answers are edited as the questions they belong to, not as raw JSON: the form
 * definition supplies the labels, and long answers get a textarea because an
 * abstract typed into a single-line input is a punishment.
 */
function ProposalDisclosure({
  submission,
  onUnauthenticated,
}: {
  readonly submission: PortalSubmission
  readonly onUnauthenticated: () => void
}) {
  const [open, setOpen] = useState(false)
  const detailQuery = useOwnSubmission(open ? submission.id : null)
  const detail = detailQuery.data
  const expired = detailQuery.isError && getApiErrorCode(detailQuery.error) === 'unauthorized'

  useEffect(() => {
    if (expired) onUnauthenticated()
  }, [expired, onUnauthenticated])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={`proposal-${submission.id}`}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Hide proposal' : 'View proposal'}
      </Button>
      {open ? (
        <div id={`proposal-${submission.id}`} className="w-full">
          {expired ? (
            <AlertLive>Your session expired. Sign in again to view this proposal.</AlertLive>
          ) : detailQuery.isError ? (
            <AlertLive>Unable to load this proposal right now.</AlertLive>
          ) : detail === undefined ? (
            <StatusLive aria-live="polite">Loading your proposal…</StatusLive>
          ) : (
            <ProposalEditor detail={detail} />
          )}
        </div>
      ) : null}
    </>
  )
}

/**
 * Everyone on the proposal, and in what capacity.
 *
 * A co-speaker typed into the wizard was stored with their role and then never
 * shown back to the person who added them, so the only way to check whether a
 * colleague had actually been included was to submit again. Names read as a
 * list rather than a count, because "1 co-speaker" does not answer "did I spell
 * Marcus's address right".
 */
function ProposalPeople({ detail }: { readonly detail: SubmissionDetailDto }) {
  if (detail.contributors.length === 0) return null
  return (
    <div className="grid gap-1 pt-2">
      <p className="text-xs font-medium text-muted-foreground">On this proposal</p>
      <ul className="grid gap-0.5">
        {detail.contributors.map((person) => (
          <li key={person.contactId} className="text-sm">
            <span className="font-medium">{person.name || person.email}</span>
            {/* The role is the point: a programme needs to know who is
                presenting and who is credited, and the database has stored
                that distinction all along. */}
            <span className="text-muted-foreground">{` — ${person.role}`}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProposalEditor({ detail }: { readonly detail: SubmissionDetailDto }) {
  const edit = useEditOwnSubmission(detail.id)
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(detail.answers ?? {}).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(', ') : String(value ?? ''),
      ]),
    ),
  )
  const [message, setMessage] = useState<string | null>(null)

  // The server decides; this surface reports. A closed call must not merely hide
  // the button — the write is refused too, which the integration suite pins.
  if (!detail.editable) {
    return (
      <div className="grid gap-2 pt-2">
        <p className="text-sm text-muted-foreground">
          Editing is closed — the call for papers has ended. This is the proposal the organizers
          have on file.
        </p>
        <dl className="grid gap-2">
          {Object.entries(answers).map(([key, value]) => (
            <div key={key} className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{key}</dt>
              <dd className="text-sm whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
        <ProposalPeople detail={detail} />
      </div>
    )
  }

  return (
    <form
      className="grid gap-3 pt-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (edit.isPending) return
        setMessage(null)
        edit.mutate(
          { title: detail.title, answers },
          {
            onSuccess: () => setMessage('Saved'),
            onError: (error) =>
              setMessage(getApiErrorMessage(error, 'Unable to save your changes.')),
          },
        )
      }}
      noValidate
    >
      {Object.entries(answers).map(([key, value]) => {
        const id = `answer-${detail.id}-${key}`
        const long = value.length > 80
        return (
          <Field key={key}>
            <FieldLabel htmlFor={id}>{key}</FieldLabel>
            {long ? (
              <Textarea
                id={id}
                value={value}
                rows={4}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            ) : (
              <Input
                id={id}
                value={value}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            )}
          </Field>
        )
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" pending={edit.isPending}>
          {edit.isPending ? 'Saving…' : 'Save changes'}
        </Button>
        <StatusLive aria-live="polite">{edit.isPending ? null : message}</StatusLive>
      </div>
      <ProposalPeople detail={detail} />
    </form>
  )
}

/**
 * The invite download for an accepted submission. The route answers 409 for an
 * event whose dates are not configured, and a `download` anchor would write
 * that JSON error to disk as the .ics — so an unavailable invite is stated in
 * words instead of being offered as a broken link.
 */
function InviteLink({ submission }: { readonly submission: PortalSubmission }) {
  // The decision, not the acceptance boolean: a rejection can land on a row
  // whose `accepted` flag has not caught up, and handing that speaker a
  // calendar hold for a slot they did not get is the worst version of this bug.
  if (resolveDecision(submission) !== 'accepted') return null
  if (!submission.inviteAvailable) {
    return (
      <span className="text-xs text-muted-foreground">
        The calendar invite becomes available once the organizer sets the event dates.
      </span>
    )
  }
  return (
    <TextLink
      hit
      className="text-xs"
      href={`/api/public/invite/${encodeURIComponent(submission.id)}.ics`}
      download
    >
      Download the calendar invite
    </TextLink>
  )
}

/**
 * The outcome, in the speaker's own words.
 *
 * The persisted status is pinned to 'pending' for a submission's whole life, so
 * the decision record is the only thing that can answer this — and it has three
 * answers, not two. A turned-down proposal used to read "Pending review" for
 * ever, which meant the product could tell a speaker they had been accepted but
 * never that they had not, and left them waiting on an answer that had already
 * been given.
 *
 * Rejection gets the destructive tint because it is the outcome that closes a
 * door, and a speaker deserves to see which of the three states they are in
 * before they read the word. The chip is never a control in any of them —
 * nothing here is the speaker's to change.
 */
function DecisionBadge({ decision }: { readonly decision: SubmissionOutcome }) {
  if (decision === 'rejected') {
    return (
      <Badge dot variant="destructive">
        Rejected
      </Badge>
    )
  }
  if (decision === 'accepted') {
    return (
      <Badge dot variant="secondary">
        Accepted
      </Badge>
    )
  }
  return (
    <Badge dot variant="outline">
      Pending review
    </Badge>
  )
}

function AssignmentsPanel() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['public', 'assignments'],
    queryFn: () =>
      requestJson<
        readonly {
          id: string
          title: string
          dueAt: string | null
          kind: string
          status: string
          instructions: string
        }[]
      >('/api/public/assignments'),
  })
  const complete = useMutation({
    mutationFn: (id: string) =>
      requestJson(`/api/public/assignments/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['public', 'assignments'] })
    },
  })
  const upload = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const response = await fetch('/api/public/profile/document', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': file.type, 'x-file-name': file.name },
        body: await file.arrayBuffer(),
      })
      if (!response.ok) throw new Error('upload failed')
      await requestJson(`/api/public/assignments/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['public', 'assignments'] })
      void client.invalidateQueries({ queryKey: ['public', 'document'] })
    },
  })
  const items = query.data ?? []
  if (items.length === 0) return null
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">Assigned tasks</h2>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={item.id} className="grid gap-1">
            <span>
              {item.title}
              {item.dueAt !== null ? ` · due ${item.dueAt}` : ''} · {item.status}
              {item.kind === 'file_request' ? ' · file request' : ''}
            </span>
            {item.instructions !== '' ? (
              <span className="text-xs text-muted-foreground">{item.instructions}</span>
            ) : null}
            {item.status === 'pending' && item.kind === 'file_request' ? (
              <label className="text-sm">
                Upload against this task
                <input
                  type="file"
                  accept="application/pdf,text/plain"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file !== undefined) upload.mutate({ id: item.id, file })
                  }}
                />
              </label>
            ) : null}
            {item.status === 'pending' && item.kind !== 'file_request' ? (
              <Button type="button" variant="outline" onClick={() => complete.mutate(item.id)}>
                Mark complete
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
