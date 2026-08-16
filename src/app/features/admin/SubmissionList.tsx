import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import type { SubmissionListItemDto } from '../../../application'
import { getApiErrorCode } from '../../api/admin-events'
import { useSubmissionList } from '../../queries/admin-submissions'
import { AlertLive } from '../../../components/ui/alert-live'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { Badge } from '../../../components/ui/badge'
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
import { preserveDeskLinkNavigation } from './programme-spotlight'
import { useProgrammeSpotlight } from './useProgrammeSpotlight'
import {
  DEFAULT_SUBMISSION_OPERATIONS,
  operateOnSubmissions,
  readSubmissionOperations,
  submissionsCsv,
  writeSubmissionOperations,
} from './submission-operations'

/*
 * The persisted submission `status` is pinned to 'pending' for the whole life
 * of a proposal (migration 0002). The list therefore never prints that field.
 * The standing verdict lives on `decision` (accepted / rejected / pending) and
 * is the column this table may show. The row link's accessible name stays
 * identity only — title + primary speaker — so a verdict change does not
 * rename the proposal.
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

function DecisionChip({
  decision,
}: {
  readonly decision: 'pending' | 'accepted' | 'rejected' | undefined
}) {
  if (decision === 'accepted') {
    return (
      <Badge dot variant="secondary">
        Accepted
      </Badge>
    )
  }
  if (decision === 'rejected') {
    return (
      <Badge dot variant="outline">
        Rejected
      </Badge>
    )
  }
  return <span className="text-muted-foreground">Pending review</span>
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
  const [term, setTerm] = useState('')
  const [operations, setOperations] = useState(() =>
    typeof window === 'undefined'
      ? DEFAULT_SUBMISSION_OPERATIONS
      : readSubmissionOperations(window.location.search),
  )

  useEffect(() => {
    document.title = 'Submissions — Open Events'
  }, [])

  useEffect(() => {
    const search = writeSubmissionOperations(window.location.search, operations)
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    )
  }, [operations])

  useEffect(() => {
    const syncFromHistory = () => setOperations(readSubmissionOperations(window.location.search))
    window.addEventListener('popstate', syncFromHistory)
    return () => window.removeEventListener('popstate', syncFromHistory)
  }, [])

  const rows = listQuery.data
  const matches = operateOnSubmissions(rows ?? [], term, operations)
  const routingOptions = [
    ...new Set((rows ?? []).flatMap((row) => row.routing?.actionTarget ?? [])),
  ].sort((left, right) => left.localeCompare(right))
  const matchIds = matches.map((row) => row.id)
  const { spotlightId, select } = useProgrammeSpotlight(matchIds)
  const selected = matches.find((row) => row.id === spotlightId) ?? matches[0] ?? null
  const hasRows = rows !== undefined && rows.length > 0

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
          <div
            data-slot="submissions-canvas"
            data-spotlight={selected?.id ?? undefined}
            className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start"
          >
            <div className="grid min-w-0 gap-3">
              <Field className="max-w-sm">
                <FieldLabel htmlFor="submission-search">
                  Search submissions — j and k move the spotlight
                </FieldLabel>
                <Input
                  id="submission-search"
                  type="search"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                />
              </Field>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <NativeSelect
                  aria-label="Filter by decision"
                  value={operations.decision}
                  onChange={(event) =>
                    setOperations((current) => ({
                      ...current,
                      decision: event.target.value as typeof current.decision,
                    }))
                  }
                >
                  <option value="all">All decisions</option>
                  <option value="pending">Pending review</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                </NativeSelect>
                <NativeSelect
                  aria-label="Filter by routing"
                  value={operations.routing}
                  onChange={(event) =>
                    setOperations((current) => ({ ...current, routing: event.target.value }))
                  }
                >
                  <option value="all">All routing</option>
                  {routingOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Sort submissions"
                  value={operations.sort}
                  onChange={(event) =>
                    setOperations((current) => ({
                      ...current,
                      sort: event.target.value as typeof current.sort,
                    }))
                  }
                >
                  <option value="submitted-desc">Newest submitted</option>
                  <option value="submitted-asc">Oldest submitted</option>
                  <option value="title-asc">Title A–Z</option>
                  <option value="decision-asc">Decision</option>
                </NativeSelect>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTerm('')
                      setOperations(DEFAULT_SUBMISSION_OPERATIONS)
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={matches.length === 0}
                    onClick={() => downloadSubmissionCsv(slug ?? 'event', matches)}
                  >
                    Export CSV
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Showing {matches.length} of {rows.length} proposals
              </p>
              {matches.length === 0 ? (
                <EmptyState
                  title="Nothing matches that"
                  description="Try part of a title, a speaker name, or an email."
                />
              ) : (
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
                      <TableHead scope="col">Routing</TableHead>
                      <TableHead scope="col">Decision</TableHead>
                      <TableHead scope="col">Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matches.map((row) => (
                      <TableRow
                        key={row.id}
                        className={ROW_EMPHASIS}
                        data-selected={selected?.id === row.id ? '' : undefined}
                        onClick={() => select(row.id)}
                      >
                        <TableCell pinned>
                          <Link
                            to="/admin/events/$slug/submissions/$submissionId"
                            params={{ slug: slug ?? '', submissionId: row.id }}
                            aria-label={`${row.title} — ${row.primarySpeaker.name}`}
                            className={linkVariants({ hit: true, className: ROW_LINK_HIT })}
                            onClick={preserveDeskLinkNavigation}
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
                        <TableCell>
                          <DecisionChip decision={row.decision} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          <time dateTime={row.submittedAt}>{formatSubmitted(row.submittedAt)}</time>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {selected !== null ? <SubmissionPeek row={selected} slug={slug ?? ''} /> : null}
          </div>
        ) : null}
      </section>
    </AppShell>
  )
}

function downloadSubmissionCsv(slug: string, rows: readonly SubmissionListItemDto[]) {
  const url = URL.createObjectURL(
    new Blob([submissionsCsv(rows)], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${slug}-submissions.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function SubmissionPeek({
  row,
  slug,
}: {
  readonly row: SubmissionListItemDto
  readonly slug: string
}) {
  return (
    <Card data-slot="submissions-peek" className="min-w-0 w-full">
      <CardHeader className="border-b">
        <CardTitle level={2}>{row.title}</CardTitle>
        <CardDescription>
          {row.primarySpeaker.name} · {row.primarySpeaker.email}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <DecisionChip decision={row.decision} />
        <p className="text-sm text-muted-foreground">
          {row.formSlug} v{row.version}
          {row.routing?.actionTarget !== undefined && row.routing.actionTarget !== ''
            ? ` · ${row.routing.actionTarget}`
            : ''}
        </p>
        <Link
          to="/admin/events/$slug/submissions/$submissionId"
          params={{ slug, submissionId: row.id }}
          className={linkVariants({ hit: true })}
        >
          Open proposal
        </Link>
      </CardContent>
    </Card>
  )
}
