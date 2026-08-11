import { useEffect } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
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
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{HEADING}</h1>
        <Card>
          <CardContent>
            <StatusLive aria-live="polite">Taking you to the sign-in step…</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{HEADING}</h1>
        <Card>
          <CardContent className="grid justify-items-start gap-3">
            <AlertLive>Your submissions are unavailable right now.</AlertLive>
            <Button
              type="button"
              className="min-h-6"
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
      <div className="grid gap-4" aria-busy={query.isPending}>
        <h1 className="text-2xl font-semibold">{HEADING}</h1>
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
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{HEADING}</h1>
      {data.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No submissions yet. Proposals you submit appear here; any onboarding tasks assigned to
              you are listed below.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul aria-label={HEADING} className="grid gap-3">
          {data.map((submission) => (
            <li key={submission.id}>
              <Card>
                <CardContent className="grid justify-items-start gap-1">
                  <span className="font-medium">{submission.title}</span>
                  <span className="text-sm text-muted-foreground">
                    Status: {statusLabel(submission)}
                  </span>
                  <InviteLink submission={submission} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <TasksPanel />
      <ProfileEditor />
      <HeadshotUploader />
      <DocumentUploader />
    </div>
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
      <span className="text-sm text-muted-foreground">
        The calendar invite becomes available once the organizer sets the event dates.
      </span>
    )
  }
  return (
    <a
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      href={`/api/public/invite/${encodeURIComponent(submission.id)}.ics`}
      download
    >
      Download the calendar invite
    </a>
  )
}

/**
 * The persisted status is pinned to 'pending' for a submission's whole life;
 * the acceptance record is the decision, so it is what the speaker reads here.
 */
function statusLabel(submission: PortalSubmission): string {
  return submission.accepted ? 'Accepted' : 'Pending review'
}
