import { useEffect } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { useOwnSubmissions, type PortalSubmission } from '../../queries/portal'
import HeadshotUploader from './HeadshotUploader'
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
            <StatusLive>Taking you to the sign-in step…</StatusLive>
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
              onClick={() => {
                void query.refetch()
              }}
            >
              Try again
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
            <StatusLive>Loading your submissions…</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{HEADING}</h1>
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No submissions yet. Once you submit a proposal it appears here.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{HEADING}</h1>
      <ul aria-label={HEADING} className="grid gap-3">
        {data.map((submission) => (
          <li key={submission.id}>
            <Card>
              <CardContent className="grid gap-1">
                <span className="font-medium">{submission.title}</span>
                <span className="text-sm text-muted-foreground">
                  Status: {statusLabel(submission)}
                </span>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <TasksPanel />
      <HeadshotUploader />
    </div>
  )
}

function statusLabel(submission: PortalSubmission): string {
  return submission.status.replaceAll('-', ' ')
}
