import { useEffect, useState } from 'react'

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
import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import { ForbiddenState } from '../admin/AdminStates'
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

const HEADING = 'Your submissions'
const SUBHEADING = 'Your proposals, your onboarding tasks and the profile organizers see.'

/** The measure the whole speaker journey reads at. */
const COLUMN = 'mx-auto grid w-full max-w-[47rem] gap-5'

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
    document.title = 'Your submissions — SpeakerOps'
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
    if (getApiErrorCode(query.error) === 'forbidden') return <ForbiddenState />
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
    <div className={COLUMN}>
      <Header />
      {data.length === 0 ? (
        <EmptyState
          icon={<DocumentStackIcon size={20} />}
          title="Submit your first proposal"
          description="No submissions yet. Proposals you submit appear here; any onboarding tasks assigned to you are listed below."
        />
      ) : (
        <Card>
          <ul aria-label={HEADING} className="divide-y divide-border">
            {data.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium">{submission.title}</span>
                  <InviteLink submission={submission} />
                </div>
                <ProposalDisclosure submission={submission} />
                {/* Where a proposal stands is a lifecycle state, so the chip
                    carries the marker that says so — the one channel that
                    still separates a state from a plain value once colour has
                    been spent on a single accent. */}
                <DecisionBadge decision={resolveDecision(submission)} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <TasksPanel />
      <ProfileEditor />
      <HeadshotUploader />
      <DocumentUploader />
    </div>
  )
}

/** The page heading, identical in every state so the page never loses its h1. */
function Header() {
  return (
    <PageHeader>
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
function ProposalDisclosure({ submission }: { readonly submission: PortalSubmission }) {
  const [open, setOpen] = useState(false)
  const detailQuery = useOwnSubmission(open ? submission.id : null)
  const detail = detailQuery.data

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
          {detailQuery.isError ? (
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
      Object.entries(detail.answers).map(([key, value]) => [
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
