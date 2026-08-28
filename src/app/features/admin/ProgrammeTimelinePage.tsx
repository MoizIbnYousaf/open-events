import { useEffect } from 'react'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'

import type {
  ProgrammeTimelineCategory,
  ProgrammeTimelineItemDto,
} from '../../../application/dtos/programme-timeline.dto'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import { NativeSelect } from '../../../components/ui/native-select'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { linkVariants } from '../../../components/ui/link-variants'
import { getApiErrorCode } from '../../api/admin-events'
import { useProgrammeTimeline } from '../../queries/admin-programme-timeline'
import AppShell from '../nav/AppShell'
import { DeniedState, ExpiredSessionState, ForbiddenState } from './AdminStates'
import {
  compactProgrammeTimelineSearch,
  programmeTimelineSearchSchema,
} from './programme-timeline-search'

const occurredAtFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

const CATEGORY_LABELS: Record<ProgrammeTimelineCategory, string> = {
  submissions: 'Submissions',
  reviews: 'Reviews',
  decisions: 'Decisions',
  onboarding: 'Onboarding',
  communications: 'Messages',
  schedule: 'Schedule',
}

function formatOccurredAt(value: string): string {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : `${occurredAtFormatter.format(parsed)} UTC`
}

function TimelineItem({
  item,
  slug,
}: {
  readonly item: ProgrammeTimelineItemDto
  readonly slug: string
}) {
  return (
    <li className="grid gap-2 px-3 py-3 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-4">
      <time className="text-xs text-muted-foreground tabular-nums" dateTime={item.occurredAt}>
        {formatOccurredAt(item.occurredAt)}
      </time>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{CATEGORY_LABELS[item.category]}</Badge>
          <span className="font-medium">{item.title}</span>
        </div>
        <p className="text-sm text-muted-foreground break-words">{item.detail}</p>
        {item.submissionId !== null && item.submissionTitle !== null ? (
          <Link
            to="/admin/events/$slug/submissions/$submissionId"
            params={{ slug, submissionId: item.submissionId }}
            className={linkVariants({ hit: true, className: 'mt-1 w-fit text-sm' })}
            aria-label={`Open proposal ${item.submissionTitle}`}
          >
            Open proposal
          </Link>
        ) : null}
      </div>
    </li>
  )
}

export default function ProgrammeTimelinePage() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  const navigate = useNavigate()
  const search = programmeTimelineSearchSchema.parse(useSearch({ strict: false }))
  const timeline = useProgrammeTimeline(slug ?? '', search.category)

  useEffect(() => {
    document.title = 'Programme timeline — Open Events'
  }, [])

  if (timeline.isError) {
    const code = getApiErrorCode(timeline.error)
    if (code === 'unauthorized') {
      return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
    }
    if (code === 'forbidden') return <ForbiddenState />
    if (code === 'not_found') return <DeniedState />
  }

  const data = timeline.data
  const items = data?.items ?? []
  return (
    <AppShell slug={slug ?? ''}>
      <section
        className="grid gap-4"
        aria-label="Programme timeline"
        data-tour="timeline-workspace"
      >
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Programme timeline</PageHeaderTitle>
            <PageHeaderDescription>
              Source-backed milestones across intake, review, decisions, onboarding, messages and
              scheduling.
            </PageHeaderDescription>
          </PageHeaderContent>
        </PageHeader>

        <p className="max-w-3xl text-sm text-muted-foreground">
          Decisions, messages, task changes and recusals are recorded events. Review entries show
          the latest saved review, and schedule entries show current placement, because those
          records do not preserve every edit.
        </p>

        <Field className="max-w-sm">
          <FieldLabel htmlFor="timeline-category">Show milestones</FieldLabel>
          <NativeSelect
            id="timeline-category"
            value={search.category}
            onChange={(event) => {
              const next = programmeTimelineSearchSchema.parse({
                ...search,
                category: event.target.value,
              })
              void navigate({
                to: '/admin/events/$slug/timeline',
                params: { slug: slug ?? '' },
                replace: true,
                search: () => compactProgrammeTimelineSearch(next),
              })
            }}
          >
            <option value="all">All milestones</option>
            <option value="submissions">Submissions and direct sessions</option>
            <option value="reviews">Reviews</option>
            <option value="decisions">Decisions</option>
            <option value="onboarding">Onboarding</option>
            <option value="communications">Messages</option>
            <option value="schedule">Schedule</option>
          </NativeSelect>
        </Field>

        {timeline.isPending ? (
          <div className="grid gap-2" aria-busy="true">
            <StatusLive>Loading programme milestones…</StatusLive>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : timeline.isError ? (
          <div className="grid justify-items-start gap-3">
            <AlertLive>The programme timeline is unavailable right now.</AlertLive>
            <Button
              type="button"
              variant="outline"
              size="sm"
              pending={timeline.isFetching}
              onClick={() => void timeline.refetch()}
            >
              {timeline.isFetching ? 'Trying again…' : 'Retry'}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No milestones in this view"
            description="Choose another category, or return after the programme has moved forward."
          />
        ) : (
          <>
            <StatusLive aria-live="polite">
              {items.length} {items.length === 1 ? 'milestone' : 'milestones'}, newest first.
            </StatusLive>
            {data?.truncated === true ? (
              <AlertLive>
                Showing the latest {data.limit} matching milestones. Older entries remain in their
                source records.
              </AlertLive>
            ) : null}
            <ol
              aria-label="Programme lifecycle milestones"
              className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
            >
              {items.map((item) => (
                <TimelineItem key={item.id} item={item} slug={slug ?? ''} />
              ))}
            </ol>
          </>
        )}
      </section>
    </AppShell>
  )
}
