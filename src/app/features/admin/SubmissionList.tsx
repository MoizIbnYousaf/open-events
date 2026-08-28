import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'

import type { SubmissionListItemDto } from '../../../application'
import { SUBMISSION_DESK_PAGE_SIZE } from '../../../application/dtos/submission-desk.dto'
import { getApiErrorCode } from '../../api/admin-events'
import { useSubmissionDesk } from '../../queries/admin-submissions'
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
import { Checkbox } from '../../../components/ui/checkbox'
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
import { useControlledProgrammeSpotlight } from './useProgrammeSpotlight'
import { SubmissionFacetFilters } from './SubmissionFacetFilters'
import { SubmissionViews } from './SubmissionViews'
import { submissionsCsv } from './submission-operations'
import {
  DEFAULT_SUBMISSION_SEARCH,
  compactSubmissionSearch,
  submissionSearchSchema,
  toSubmissionDeskQuery,
  toSubmissionViewState,
  type SubmissionSearch,
  type SubmissionSearchInput,
} from './submission-search'

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
const MAX_PAGE_SELECTION = SUBMISSION_DESK_PAGE_SIZE

function PageSelectionCheckbox({
  checked,
  mixed,
  label,
  onChange,
}: {
  readonly checked: boolean
  readonly mixed?: boolean
  readonly label: string
  readonly onChange: (checked: boolean) => void
}) {
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (input.current !== null) input.current.indeterminate = mixed === true
  }, [mixed])
  return (
    <Checkbox
      ref={input}
      aria-label={label}
      checked={checked}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

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
  const search = submissionSearchSchema.parse(useSearch({ strict: false }))
  const deskQuery = toSubmissionDeskQuery(search)
  const listQuery = useSubmissionDesk(slug, deskQuery)
  const [queryDraft, setQueryDraft] = useState({ url: search.q, input: search.q })
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [copyNotice, setCopyNotice] = useState<number | 'failed' | null>(null)
  if (queryDraft.url !== search.q) setQueryDraft({ url: search.q, input: search.q })
  const queryText = queryDraft.input
  const desk = listQuery.data

  const navigateSearch = useCallback(
    (update: Partial<SubmissionSearch>, options: { readonly transient?: boolean } = {}) => {
      if (slug === undefined) return
      void navigate({
        to: '/admin/events/$slug/submissions',
        params: { slug },
        replace: true,
        search: (current: SubmissionSearchInput) => {
          const normalized = submissionSearchSchema.parse(current)
          return compactSubmissionSearch(
            submissionSearchSchema.parse({
              ...normalized,
              ...update,
              tour: normalized.tour ?? search.tour,
              page:
                options.transient === true ? (update.page ?? normalized.page) : (update.page ?? 1),
              view: options.transient === true ? normalized.view : update.view,
              spotlight: options.transient === true ? update.spotlight : undefined,
            }),
          )
        },
      })
    },
    [navigate, search.tour, slug],
  )
  const setSearch = useCallback(
    (update: Partial<SubmissionSearch>, options: { readonly transient?: boolean } = {}) => {
      if (options.transient !== true) {
        setSelectedIds(new Set())
        setCopyNotice(null)
      }
      navigateSearch(update, options)
    },
    [navigateSearch],
  )

  useEffect(() => {
    document.title = 'Submissions — Open Events'
  }, [])

  useEffect(() => {
    if (queryText === search.q) return
    const timeout = window.setTimeout(() => setSearch({ q: queryText }), 200)
    return () => window.clearTimeout(timeout)
  }, [queryText, search.q, setSearch])

  useEffect(() => {
    if (desk !== undefined && desk.page !== search.page) {
      navigateSearch({ page: desk.page }, { transient: true })
    }
  }, [desk, navigateSearch, search.page])

  const rows = desk?.rows
  const matches = rows ?? []
  const routingOptions = desk?.routingOptions ?? []
  const matchIds = matches.map((row) => row.id)
  const selectedRows = matches.filter((row) => selectedIds.has(row.id)).slice(0, MAX_PAGE_SELECTION)
  const allPageRowsSelected = matches.length > 0 && selectedRows.length === matches.length
  const somePageRowsSelected = selectedRows.length > 0 && !allPageRowsSelected
  const setRowSelected = (id: string, checked: boolean) => {
    setCopyNotice(null)
    setSelectedIds((current) => {
      const liveIds = new Set(matchIds)
      const next = new Set([...current].filter((candidate) => liveIds.has(candidate)))
      if (checked && next.size < MAX_PAGE_SELECTION) next.add(id)
      else if (!checked) next.delete(id)
      return next
    })
  }
  const setAllPageRowsSelected = (checked: boolean) => {
    setCopyNotice(null)
    setSelectedIds(checked ? new Set(matchIds.slice(0, MAX_PAGE_SELECTION)) : new Set())
  }
  const selectSpotlight = useCallback(
    (spotlight: string | null) =>
      setSearch({ spotlight: spotlight ?? undefined }, { transient: true }),
    [setSearch],
  )
  const { spotlightId, select } = useControlledProgrammeSpotlight(
    matchIds,
    search.spotlight,
    selectSpotlight,
  )
  const selected = matches.find((row) => row.id === spotlightId) ?? matches[0] ?? null
  const hasRows = desk !== undefined && desk.total > 0

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
      <section
        aria-label="Submissions"
        aria-busy={listQuery.isPending}
        className="grid gap-4"
        data-tour="submissions-table"
      >
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
                ? `${desk?.total ?? 0} ${desk?.total === 1 ? 'proposal' : 'proposals'} from the call for papers.`
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
        ) : desk !== undefined && desk.total === 0 ? (
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
        ) : desk !== undefined ? (
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
                  value={queryText}
                  onChange={(event) => {
                    setSelectedIds(new Set())
                    setCopyNotice(null)
                    setQueryDraft((current) => ({ ...current, input: event.target.value }))
                  }}
                />
              </Field>
              <SubmissionViews
                eventSlug={slug ?? ''}
                activeViewId={search.view}
                currentState={toSubmissionViewState(search)}
                onApply={(view) =>
                  setSearch({
                    q: view.state.q,
                    decision: view.state.decision,
                    routing: view.state.routing,
                    sort: view.state.sort,
                    facets: view.state.facets.map((facet) => ({
                      elementId: facet.elementId,
                      values: [...facet.values],
                    })),
                    page: 1,
                    view: view.id,
                  })
                }
                onDeleted={(id) => {
                  if (search.view !== id) return
                  setSearch({
                    q: search.q,
                    decision: search.decision,
                    routing: search.routing,
                    sort: search.sort,
                    facets: search.facets,
                    page: search.page,
                    view: undefined,
                  })
                }}
              />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <NativeSelect
                  aria-label="Filter by decision"
                  value={search.decision}
                  onChange={(event) =>
                    setSearch({
                      decision: event.target.value as SubmissionSearch['decision'],
                    })
                  }
                >
                  <option value="all">All decisions</option>
                  <option value="pending">Pending review</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                </NativeSelect>
                <NativeSelect
                  aria-label="Filter by routing"
                  value={search.routing}
                  onChange={(event) => setSearch({ routing: event.target.value })}
                >
                  <option value="all">All routing</option>
                  {routingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value} ({option.count})
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Sort submissions"
                  value={search.sort}
                  onChange={(event) =>
                    setSearch({ sort: event.target.value as SubmissionSearch['sort'] })
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
                      setQueryDraft((current) => ({ ...current, input: '' }))
                      setSearch({
                        ...DEFAULT_SUBMISSION_SEARCH,
                        tour: search.tour,
                      })
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
                    Export page CSV
                  </Button>
                </div>
              </div>
              <SubmissionFacetFilters
                facets={desk.facetCounts}
                selections={search.facets}
                onChange={(facets) =>
                  setSearch({
                    facets: facets.map((facet) => ({
                      elementId: facet.elementId,
                      values: [...facet.values],
                    })),
                  })
                }
              />
              {desk.invalidFacetSelections.length > 0 ? (
                <div className="grid justify-items-start gap-2">
                  <AlertLive>
                    This saved filter references an answer that is no longer available. No proposals
                    are shown until it is cleared.
                  </AlertLive>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSearch({ facets: [] })}
                  >
                    Clear unavailable filters
                  </Button>
                </div>
              ) : null}
              {desk.truncated ? (
                <AlertLive>
                  This event has more than 1,000 proposals. Refine the filters before acting on this
                  bounded view.
                </AlertLive>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {desk.matchingTotal === desk.total
                  ? `Showing ${matches.length} of ${desk.total} proposals`
                  : `Showing ${matches.length} matching of ${desk.total} proposals`}
              </p>
              {selectedRows.length > 0 ? (
                <div
                  role="region"
                  aria-label="Selected proposals"
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2"
                >
                  <span className="mr-auto text-sm font-medium">
                    {selectedRows.length} selected from this page
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => downloadSubmissionCsv(slug ?? 'event', selectedRows, true)}
                  >
                    Export selected CSV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCopyNotice(null)
                      void copyPrimarySpeakerEmails(selectedRows).then(
                        (count) => setCopyNotice(count),
                        () => setCopyNotice('failed'),
                      )
                    }}
                  >
                    Copy primary speaker emails
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedIds(new Set())
                      setCopyNotice(null)
                    }}
                  >
                    Clear selection
                  </Button>
                  {typeof copyNotice === 'number' ? (
                    <StatusLive className="basis-full" aria-live="polite">
                      Copied {copyNotice} {copyNotice === 1 ? 'email address' : 'email addresses'}.
                    </StatusLive>
                  ) : copyNotice === 'failed' ? (
                    <AlertLive className="basis-full">
                      The email addresses could not be copied.
                    </AlertLive>
                  ) : null}
                </div>
              ) : null}
              {desk.pageCount > 1 ? (
                <div className="flex flex-wrap items-center gap-2" aria-label="Submission pages">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={desk.page <= 1}
                    onClick={() => setSearch({ page: Math.max(1, desk.page - 1) })}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    Page {desk.page} of {desk.pageCount}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={desk.page >= desk.pageCount}
                    onClick={() => setSearch({ page: Math.min(desk.pageCount, desk.page + 1) })}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
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
                      <TableHead scope="col" className="w-12 text-center">
                        <PageSelectionCheckbox
                          checked={allPageRowsSelected}
                          mixed={somePageRowsSelected}
                          label="Select all proposals on this page"
                          onChange={setAllPageRowsSelected}
                        />
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
                        data-state={selectedIds.has(row.id) ? 'selected' : undefined}
                        onClick={() => select(row.id)}
                      >
                        <TableCell pinned>
                          <Link
                            to="/admin/events/$slug/submissions/$submissionId"
                            params={{ slug: slug ?? '', submissionId: row.id }}
                            search
                            aria-label={`${row.title} — ${row.primarySpeaker.name}`}
                            className={linkVariants({ hit: true, className: ROW_LINK_HIT })}
                            onClick={preserveDeskLinkNavigation}
                          >
                            {row.title}
                          </Link>
                        </TableCell>
                        <TableCell className="text-center">
                          <PageSelectionCheckbox
                            checked={selectedIds.has(row.id)}
                            label={`Select ${row.title}`}
                            onChange={(checked) => setRowSelected(row.id, checked)}
                          />
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

function downloadSubmissionCsv(
  slug: string,
  rows: readonly SubmissionListItemDto[],
  selected = false,
) {
  const url = URL.createObjectURL(
    new Blob([submissionsCsv(rows)], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${slug}-${selected ? 'selected-' : ''}submissions.csv`
  link.click()
  URL.revokeObjectURL(url)
}

async function copyPrimarySpeakerEmails(rows: readonly SubmissionListItemDto[]): Promise<number> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    throw new Error('Clipboard unavailable')
  }
  const emails = [...new Set(rows.map((row) => row.primarySpeaker.email))]
  await navigator.clipboard.writeText(emails.join('\n'))
  return emails.length
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
          search
          className={linkVariants({ hit: true })}
        >
          Open proposal
        </Link>
      </CardContent>
    </Card>
  )
}
