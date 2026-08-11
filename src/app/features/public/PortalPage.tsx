import { useEffect } from 'react'

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
import { getApiErrorCode } from '../../api/admin-events'
import { ForbiddenState } from '../admin/AdminStates'
import { useOwnSubmissions, type PortalSubmission } from '../../queries/portal'
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
                {/* Where a proposal stands is a lifecycle state, so the chip
                    carries the marker that says so — the one channel that
                    still separates a state from a plain value once colour has
                    been spent on a single accent. */}
                <Badge dot variant={submission.accepted ? 'secondary' : 'outline'}>
                  {statusLabel(submission)}
                </Badge>
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
 * The invite download for an accepted submission. The route answers 409 for an
 * event whose dates are not configured, and a `download` anchor would write
 * that JSON error to disk as the .ics — so an unavailable invite is stated in
 * words instead of being offered as a broken link.
 */
function InviteLink({ submission }: { readonly submission: PortalSubmission }) {
  if (!submission.accepted) return null
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
 * The persisted status is pinned to 'pending' for a submission's whole life;
 * the acceptance record is the decision, so it is what the speaker reads here.
 */
function statusLabel(submission: PortalSubmission): string {
  return submission.accepted ? 'Accepted' : 'Pending review'
}
