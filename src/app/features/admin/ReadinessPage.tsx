import { useEffect } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { useOrganizerReadiness } from '../../queries/portal-tasks'

interface ReadinessPageProps {
  /** Routed event slug: readiness only ever reads this event's rows. */
  readonly eventSlug: string
}

/**
 * REQ-012 organizer readiness for one event. Bounded polling (DEC-005) keeps
 * the table fresh without a socket; the page owns exactly one h1 per state.
 */
export default function ReadinessPage({ eventSlug }: ReadinessPageProps) {
  const query = useOrganizerReadiness(eventSlug)

  useEffect(() => {
    document.title = 'Readiness — SpeakerOps'
  }, [])

  if (eventSlug === '') {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Readiness</h1>
        <Card>
          <CardContent>
            <AlertLive>Readiness is only available from an event page.</AlertLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (query.isPending) {
    return (
      <section aria-label="Readiness" aria-busy="true">
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <StatusLive>Loading readiness…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Readiness</h1>
      {query.isError ? (
        <Card>
          <CardContent className="grid gap-3">
            <AlertLive>Unable to load readiness.</AlertLive>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : query.data.length === 0 ? (
        <Card>
          <CardContent>
            <StatusLive>No submissions to track yet.</StatusLive>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Speaker task readiness by submission</caption>
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Speaker</th>
                  <th scope="col">Outstanding</th>
                  <th scope="col">Complete</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((row) => (
                  <tr key={row.submissionId}>
                    <td>{row.title}</td>
                    <td>{row.speakerEmail}</td>
                    <td>{`${row.outstandingCount} outstanding`}</td>
                    <td>{`${row.completeCount} complete`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
