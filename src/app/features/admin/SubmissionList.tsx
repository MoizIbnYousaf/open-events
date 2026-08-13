import { useEffect } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import { getApiErrorCode } from '../../api/admin-events'
import { useSubmissionList } from '../../queries/admin-submissions'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
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
import AppShell from '../nav/AppShell'
import { DeniedState, ExpiredSessionState, ForbiddenState } from './AdminStates'

/*
 * The persisted submission status is pinned to 'pending' for the whole life of
 * a proposal (migration 0002), because the acceptance record — not a status
 * column — IS the accepted state.
 *
 * It is not a visible column: a column that can only ever print one word was
 * read as the acceptance decision, so the list said "Pending" about a proposal
 * the detail page had already recorded as accepted and emailed. The list makes
 * exactly one read and that read cannot see acceptances, so the decision is
 * reported where it is known — on the proposal itself.
 *
 * It is not in the row link's accessible name either, which is where it hid
 * after the column went. A row's accessible name is its IDENTITY — which
 * proposal is this — and a token the list cannot keep true is not identity, it
 * is the same lie spoken to a screen-reader user instead of a sighted one. The
 * name is now title + primary speaker: two facts the list actually holds.
 */

/**
 * The same absolute treatment `format-instant.ts` gives the detail chunk, kept
 * here as its own copy on purpose: this list is a different lazy chunk, and a
 * module shared across two of them is emitted as a THIRD chunk whose filename
 * has to be listed in the entry's preload map — which spends bytes from the
 * one budget in this product that is measured in tens of them. Ten lines twice
 * is the cheaper of the two prices. Any change here belongs in both files.
 */
const submittedFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatSubmitted(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : submittedFormatter.format(date)
}

/**
 * Emphasis that cannot move the grid: an inset outline paints inside the cell
 * box, so a hovered row never nudges its neighbours by a pixel the way a
 * border would. Focus stays on the link's own ring — one focus signal per
 * page, and it belongs to the thing that will actually activate.
 *
 * The hover wash itself is the primitive's, so the pinned identity cell paints
 * the same colour as the rest of its row; this file used to name a second one
 * and the pinned column lit up lighter than the row behind it.
 */
const ROW_EMPHASIS = 'hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-border'

/**
 * The title column carries the row's identity and the row's only link, so it
 * gets the width. Left to the auto table algorithm with `w-full` on a trailing
 * column, every other column collapsed to min-content and the title wrapped one
 * word per line at 1440px while a cell holding an em-dash took 495px. A share
 * plus a floor is what keeps it readable at every width instead of only wide
 * ones.
 */
const TITLE_COLUMN = 'w-[38%] min-w-[15rem]'

/**
 * The link owns the cell, not just its own text. The row lights up on hover, so
 * a 24 x 24px target inside a 1152 x 56px row was an affordance that led
 * nowhere for everything but the words themselves. Negative margins cancel the
 * cell padding so the link covers it; the row still holds exactly one link.
 */
const ROW_LINK_HIT = '-my-2 -ml-2 w-[calc(100%+0.5rem)] py-2 pl-2'

/**
 * Loading rows shaped like the table that replaces them: same column rhythm,
 * same row height, so nothing reflows when the data lands. Deliberately not a
 * real `<table>` — an empty table would claim the table role and its column
 * headers before there is anything to read.
 */
function SubmissionListSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border border-border divide-y divide-border"
    >
      <div className="flex h-8 items-center gap-3 bg-muted/50 px-2">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-2.5 w-14" />
        <Skeleton className="ml-auto h-2.5 w-20" />
      </div>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="flex items-center gap-3 px-2 py-2.5">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="ml-auto h-3.5 w-28" />
        </div>
      ))}
    </div>
  )
}

export default function SubmissionList() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  const navigate = useNavigate()
  const listQuery = useSubmissionList(slug)

  useEffect(() => {
    document.title = 'Submissions — Open Events'
  }, [])

  if (listQuery.isError) {
    const code = getApiErrorCode(listQuery.error)
    if (code === 'unauthorized') {
      return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
    }
    // 403 and 404 answer different questions and no longer share a face. Every
    // admin route answers the same safe 404 for an id that is absent AND for
    // one that belongs to another event, so a 403 can only come from the actor
    // middleware — "the session on this browser is not an organizer's" — and
    // carries nothing about whether anything exists. Printing "Not found" over
    // it told a reader who is simply signed in as somebody else that the page
    // they asked for does not exist.
    if (code === 'forbidden') {
      return <ForbiddenState />
    }
    if (code === 'not_found') {
      return <DeniedState />
    }
  }

  const rows = listQuery.data
  const hasRows = rows !== undefined && rows.length > 0

  return (
    <AppShell slug={slug ?? ''}>
      <section aria-label="Submissions" aria-busy={listQuery.isPending} className="grid gap-4">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Submissions</PageHeaderTitle>
            {/* How many proposals, said about the rows actually on screen and
                nowhere else. The number is the length of the list this page is
                showing — not a second query, and not a total the table could
                disagree with — so it can never claim a count the reader cannot
                also scroll to. It stays OUT of the h1: the heading names the
                page, and a name that changed every time a proposal arrived
                would move a landmark the focus contract is pinned to. Until
                there are rows the line keeps saying where they come from,
                because "0 proposals" answers a question nobody asked on a page
                that has an empty state to explain itself. */}
            <PageHeaderDescription>
              {hasRows
                ? `${rows.length} ${rows.length === 1 ? 'proposal' : 'proposals'} from the call for papers.`
                : 'Proposals arrive here from the call for papers.'}
            </PageHeaderDescription>
          </PageHeaderContent>
          {hasRows && (
            <PageHeaderActions>
              <Button
                variant="outline"
                size="sm"
                pending={listQuery.isFetching}
                onClick={() => void listQuery.refetch()}
              >
                {listQuery.isFetching ? 'Refreshing…' : 'Refresh'}
              </Button>
            </PageHeaderActions>
          )}
        </PageHeader>
        {listQuery.isPending ? (
          <div className="grid gap-3">
            <SubmissionListSkeleton />
            <StatusLive aria-live="polite">Loading submissions…</StatusLive>
          </div>
        ) : listQuery.isError ? (
          <div className="grid justify-items-start gap-3">
            <AlertLive>Unable to load submissions.</AlertLive>
            <Button
              variant="outline"
              size="sm"
              pending={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
            >
              {listQuery.isFetching ? 'Trying again…' : 'Retry'}
            </Button>
          </div>
        ) : rows !== undefined && rows.length === 0 ? (
          <EmptyState
            icon={<InboxIcon size={20} />}
            title="Invite your first proposal"
            description={
              <StatusLive aria-live="polite" aria-label="No submissions">
                No submissions yet. Every proposal a speaker sends lands on this page.
              </StatusLive>
            }
          >
            <Button
              variant="outline"
              size="sm"
              pending={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
            >
              {listQuery.isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
          </EmptyState>
        ) : rows !== undefined ? (
          <Table className="min-w-[46rem]">
            <TableCaption className="sr-only">Proposals submitted to this event</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" pinned className={TITLE_COLUMN}>
                  Title
                </TableHead>
                <TableHead scope="col">Primary speaker</TableHead>
                <TableHead scope="col">Co-speakers</TableHead>
                <TableHead scope="col">Form/Version</TableHead>
                {/* Named for what the cell holds: the routing rule's action
                    target, not a track-and-tags list. */}
                <TableHead scope="col">Routing</TableHead>
                <TableHead scope="col">Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className={ROW_EMPHASIS}>
                  <TableCell pinned>
                    <Link
                      to="/admin/events/$slug/submissions/$submissionId"
                      params={{ slug: slug ?? '', submissionId: row.id }}
                      aria-label={`${row.title} — ${row.primarySpeaker.name}`}
                      className={linkVariants({ hit: true, className: ROW_LINK_HIT })}
                    >
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>{row.primarySpeaker.name}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {row.coSpeakerCount}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.formSlug} v{row.version}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.routing?.actionTarget ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <time dateTime={row.submittedAt}>{formatSubmitted(row.submittedAt)}</time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>
    </AppShell>
  )
}
