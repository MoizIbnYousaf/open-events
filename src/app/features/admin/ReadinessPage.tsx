import { useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { InboxIcon } from '../../../components/ui/icons'
import { linkVariants } from '../../../components/ui/link-variants'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table'
import { getApiErrorCode } from '../../api/admin-events'
import { useOrganizerReadiness } from '../../queries/portal-tasks'
import { ExpiredSessionState } from './AdminStates'

interface ReadinessPageProps {
  /** Routed event slug: readiness only ever reads this event's rows. */
  readonly eventSlug: string
}

/**
 * The expired-session branch, as its own component so the router hook it needs
 * is only ever called when the branch is actually rendered.
 *
 * The split still earns its keep now that the table rows link to their
 * submissions: a `Link` is only rendered where there are rows, so the states
 * that have none — loading, empty, refused — stay renderable on their own,
 * while `useNavigate` stays out of every branch that never navigates.
 *
 * The ROUTE answers an expired session first, above `AppShell`, because a dead
 * end is a page and not a card inside a rail of destinations the reader can no
 * longer open (V4-N4). This is the same answer for anyone who renders the page
 * directly, without that route around it.
 */
function ExpiredReadinessSession() {
  const navigate = useNavigate()
  return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
}

/**
 * REQ-012 organizer readiness for one event. Bounded polling (DEC-005) keeps
 * the table fresh without a socket; the page owns exactly one h1 per state.
 *
 * The aggregate carries no speaker identity on purpose: this is a count of
 * outstanding work per session, and a name beside it would widen what an
 * organizer's screen shows to anyone standing behind them.
 */
export default function ReadinessPage({ eventSlug }: ReadinessPageProps) {
  const query = useOrganizerReadiness(eventSlug)

  useEffect(() => {
    document.title = 'Readiness — Open Events'
  }, [])

  if (eventSlug === '') {
    return (
      <div className="grid gap-4">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Readiness</PageHeaderTitle>
          </PageHeaderContent>
        </PageHeader>
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
            <StatusLive aria-live="polite">Loading readiness…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }

  // Like every other organizer route: an expired session goes back to sign-in
  // rather than to a "Try again" that can only be refused again.
  if (query.isError && getApiErrorCode(query.error) === 'unauthorized') {
    return <ExpiredReadinessSession />
  }

  const rows = query.isError ? [] : query.data
  const readyCount = rows.filter((row) => row.ready).length

  return (
    <div className="grid gap-4">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Readiness</PageHeaderTitle>
          {query.isError || rows.length === 0 ? null : (
            <PageHeaderDescription>
              {readyCount} of {rows.length} {rows.length === 1 ? 'session' : 'sessions'} ready to go
            </PageHeaderDescription>
          )}
        </PageHeaderContent>
        {query.isError || rows.length === 0 ? null : (
          <PageHeaderActions>
            {/* The one number an organizer scans for, said in words and in
                shape as well as in colour: a tint alone is not a state, and
                the marker is the same one the per-row chips below now carry. */}
            <Badge variant={readyCount === rows.length ? 'secondary' : 'outline'} dot>
              {readyCount === rows.length
                ? 'Everyone is ready'
                : `${rows.length - readyCount} not ready`}
            </Badge>
          </PageHeaderActions>
        )}
      </PageHeader>
      {query.isError ? (
        <Card>
          <CardContent className="grid justify-items-start gap-3">
            <AlertLive>Unable to load readiness.</AlertLive>
            <Button
              variant="outline"
              pending={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? 'Trying again…' : 'Try again'}
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        // Passive by design: nothing an organizer does on this page puts a row
        // here, so the copy stays neutral rather than pretending to a call to
        // action it cannot offer.
        <EmptyState
          icon={<InboxIcon size={20} />}
          title={<StatusLive aria-live="polite">No submissions to track yet.</StatusLive>}
          description="Accepted proposals arrive here with the tasks their speakers still owe you."
        />
      ) : (
        /* The frame belongs to the scroller, not to a box around it. A
           hand-wrapped `overflow-hidden` parent put the rounding on an element
           the content scrolls past, and clipped the one thing that had to
           escape it: this table's scroll container is a real tab stop, and its
           focus ring is an outward shadow that an ancestor's clip erased
           entirely. `bordered` draws the same frame on the element that
           actually scrolls, where nothing clips it. */
        <Table bordered>
          <TableCaption className="sr-only">Speaker task readiness by submission</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="w-full">
                Session
              </TableHead>
              <TableHead scope="col">Outstanding</TableHead>
              <TableHead scope="col">Complete</TableHead>
              <TableHead scope="col">Ready</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map((row) => (
              <TableRow key={row.submissionId}>
                <TableCell>
                  {/* The row's identity cell is the way in, exactly as it is on
                      the submissions list: this page names a proposal, says its
                      speaker still owes you three things, and used to make you
                      leave for another list and find it again by eye. The
                      recipe is the sibling list's, so the two organizer tables
                      stay one pattern — the same hit area, the same accent, and
                      an accessible name that says which proposal and what
                      activating it does. */}
                  <Link
                    to="/admin/events/$slug/submissions/$submissionId"
                    params={{ slug: eventSlug, submissionId: row.submissionId }}
                    aria-label={`${row.title} — open submission`}
                    className={linkVariants({ hit: true })}
                  >
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums whitespace-nowrap text-muted-foreground">{`${row.outstandingCount} outstanding`}</TableCell>
                <TableCell className="tabular-nums whitespace-nowrap text-muted-foreground">{`${row.completedTasks} complete`}</TableCell>
                <TableCell>
                  <Badge variant={row.ready ? 'secondary' : 'outline'} dot>
                    {row.ready ? 'Ready' : 'Not ready'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
