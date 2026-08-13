import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'

import type { AnswerValue } from '../../../domain'
import { getApiErrorCode } from '../../api/admin-events'
import { readDecision, useAcceptancePreview } from '../../queries/admin-communications'
import { useFormVersionDetail } from '../../queries/admin-forms'
import { useSubmissionDetail } from '../../queries/admin-submissions'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { InboxIcon } from '../../../components/ui/icons'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import CommunicationsPanel from './CommunicationsPanel'
import AppShell from '../nav/AppShell'
import BackLink from '../nav/BackLink'
import { DeniedState, ExpiredSessionState, ForbiddenState } from './AdminStates'
import EvaluationPanel from './EvaluationPanel'
import { formatInstant } from './format-instant'

function answerText(value: AnswerValue | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function BackToList({ slug }: { readonly slug: string }) {
  return (
    <BackLink
      to="/admin/events/$slug/submissions"
      params={{ slug }}
      /* Exact matching, or the list path prefix-matches this detail page and
         the back link is announced as the current page. */
      activeOptions={{ exact: true }}
    >
      Back to submissions
    </BackLink>
  )
}

export default function SubmissionDetail() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  const submissionId = params.submissionId as string | undefined
  const navigate = useNavigate()
  const detailQuery = useSubmissionDetail(slug, submissionId)
  const detail = detailQuery.data
  const versionQuery = useFormVersionDetail(slug, detail?.formId, detail?.versionId)
  const version = versionQuery.data
  // The verdict is a record, not a status column, so the badge reads the
  // decision. Same query key as the panel below, and the same `readDecision`
  // the panel uses: one request, one reconciliation, so the chip at the top of
  // the page can never contradict the panel stating the verdict underneath it.
  // Reading `accepted` here instead would label a rejected proposal 'Accepted',
  // because a rejection deliberately leaves the acceptance record in place.
  const acceptanceQuery = useAcceptancePreview(slug, submissionId)
  const decision = readDecision(acceptanceQuery.data)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    document.title = 'Submission — Open Events'
  }, [])

  useEffect(() => {
    if (detail !== undefined && version !== undefined) {
      headingRef.current?.focus()
    }
  }, [detail, version])

  const labelByFieldKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const element of version?.elements ?? []) {
      if (element.fieldKey !== null) {
        map.set(element.fieldKey, element.label ?? 'Answer')
      }
    }
    return map
  }, [version])

  // The acceptance preview is read here already — same query key as the panel
  // in the rail, so this adds no request — and its coded refusals are facts
  // about the whole page rather than about one card: 401 is the session, 403
  // is the organizer role, 404 is the event slug. Left to the panel they would
  // surface as a raw sentence inside a card on a page that otherwise claims
  // everything is fine, and the panel cannot answer any of them anyway (it has
  // no h1 to own a page state and no route to send the reader to). So the
  // verdict is taken here, where the ladder already has the shared states.
  const denialCode =
    getApiErrorCode(detailQuery.error) ??
    getApiErrorCode(versionQuery.error) ??
    getApiErrorCode(acceptanceQuery.error)
  if (denialCode === 'unauthorized') {
    return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
  }
  // 403 is the actor, 404 is the record, and they no longer share a face. The
  // admin routes answer the same safe 404 for a submission that is absent and
  // for one belonging to another event, so a 403 can only mean the session on
  // this browser is not an organizer's — nothing about what exists. Answering
  // that with "Not found" told a reader who is merely signed in as somebody
  // else that the proposal does not exist.
  if (denialCode === 'forbidden') {
    return <ForbiddenState />
  }
  if (detail === null || denialCode === 'not_found') {
    return <DeniedState />
  }
  if (detailQuery.isError || versionQuery.isError) {
    return (
      <AppShell slug={slug ?? ''}>
        <div className="grid justify-items-start gap-3">
          <BackToList slug={slug ?? ''} />
          <PageHeader>
            <PageHeaderContent>
              <PageHeaderTitle>Submission</PageHeaderTitle>
            </PageHeaderContent>
          </PageHeader>
          <AlertLive>Unable to load this submission.</AlertLive>
          <Button
            variant="outline"
            size="sm"
            pending={versionQuery.isFetching || detailQuery.isFetching}
            onClick={() =>
              void (versionQuery.isError ? versionQuery.refetch() : detailQuery.refetch())
            }
          >
            {versionQuery.isFetching || detailQuery.isFetching ? 'Trying again…' : 'Retry'}
          </Button>
        </div>
      </AppShell>
    )
  }
  if (detail === undefined || version === undefined) {
    return (
      <AppShell slug={slug ?? ''}>
        <div className="grid gap-4" aria-busy="true" aria-label="Loading this submission">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-64" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
            <Card>
              <CardContent className="grid gap-3">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-2/3" />
                <StatusLive aria-live="polite">Loading this submission…</StatusLive>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="grid gap-3">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      </AppShell>
    )
  }

  const answers = Object.entries(detail.answers)

  return (
    <AppShell slug={slug ?? ''}>
      <div className="grid gap-4">
        <BackToList slug={slug ?? ''} />
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle ref={headingRef} tabIndex={-1} className="outline-none">
              {detail.title}
            </PageHeaderTitle>
            {/* When it arrived — the question every detail page owes its
                reader, and the one this page dropped even though the list an
                organizer clicked in from prints it. It sits OUTSIDE the title:
                the h1 is a focus target whose accessible name is contracted,
                and a date inside it would rename the thing the page hands
                focus to. `submittedAt` is named for what it is; `createdAt` is
                when a draft was started, which is a different fact and is not
                relabelled as this one. */}
            <PageHeaderDescription>
              Submitted{' '}
              <time dateTime={detail.submittedAt}>{formatInstant(detail.submittedAt)}</time>
            </PageHeaderDescription>
          </PageHeaderContent>
          <PageHeaderActions>
            {/* Acceptance is a lifecycle STATE, so it carries the state
                marker; the version is an annotation about the form this
                proposal was answered on, so it is quiet and wears no marker.
                Colour alone used to carry that difference, and colour is the
                one channel a reader may not have. */}
            <Badge variant={decision === 'pending' ? 'outline' : 'secondary'} dot>
              {decision === 'pending' ? 'Pending' : decision === 'accepted' ? 'Accepted' : 'Rejected'}
            </Badge>
            <Badge variant="ghost">Version {detail.version}</Badge>
          </PageHeaderActions>
        </PageHeader>
        {/* The proposal is the page; decisions and evaluation are the rail
            beside it, so a reviewer never loses the text they are judging.
            The rail holds an email preview and a committee roster, so 26rem is
            the width at which its subject line stops wrapping mid-title — it
            used to break every line it held while the canvas beside a short
            proposal was hundreds of pixels of nothing. The answer values keep a
            reading measure of their own rather than running the full width of a
            desktop, without leaving the card short of its column.

            The rail runs to about 1600px on a real submission while a sparse
            proposal's answers end 76px in, and neither of the two obvious
            answers to that is right on its own. `items-start` let the answers
            card stop at its own content, which read as a card that ran out —
            a hairline edge floating in the middle of the page. Taking it away
            only moved the emptiness inside the border: measured at 1440px, a
            1603px card whose ink stopped at 76px, i.e. 1527px of framed
            nothing, in both themes.

            So the row still stretches — a proposal longer than the rail pairs
            the two columns, which is what the template is for — and only the
            side that would carry the void opts out. `self-start` makes the
            answers card end where its answers end; the rail beside it is a
            column of cards that already do. Empty page beside a rail is
            ordinary layout; empty space inside a border is a broken box. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <Card className="self-start">
            <CardContent>
              {answers.length === 0 ? (
                // A submitted proposal with nothing in it is a real state (every
                // field on its version was optional, or conditionally hidden),
                // and it used to render an empty box with no explanation.
                <EmptyState
                  icon={<InboxIcon size={20} />}
                  title="No answers were submitted"
                  description="Every question on this form version was optional or hidden for this speaker, so the proposal arrived with nothing but its title."
                />
              ) : (
                <dl className="divide-y divide-border">
                  {answers.map(([fieldKey, value]) => (
                    <div
                      key={fieldKey}
                      className="grid gap-1 py-2.5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,10rem)_minmax(0,62ch)] md:gap-4"
                    >
                      <dt className="text-xs font-medium text-muted-foreground">
                        {labelByFieldKey.get(fieldKey) ?? 'Answer'}
                      </dt>
                      <dd className="text-[15px] whitespace-pre-wrap text-foreground">
                        {answerText(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
          <div className="grid gap-4">
            <Card>
              <CardContent>
                <CommunicationsPanel slug={slug ?? ''} submissionId={detail.id} />
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <EvaluationPanel slug={slug ?? ''} submissionId={submissionId ?? ''} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
