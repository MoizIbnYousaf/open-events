import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'

import type { AnswerValue } from '../../../domain'
import { getApiErrorCode, requestJson } from '../../api/admin-events'
import { readDecision, useAcceptancePreview } from '../../queries/admin-communications'
import { useFormVersionDetail } from '../../queries/admin-forms'
import { useSubmissionDetail } from '../../queries/admin-submissions'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { ButtonGroup } from '../../../components/ui/button-group'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { Textarea } from '../../../components/ui/textarea'
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
          <div
            data-slot="submission-canvas"
            className="flex flex-col gap-4 xl:flex-row xl:items-start"
          >
            <div data-slot="submission-proposal" className="grid min-w-0 w-full max-w-3xl gap-4">
              <Card>
                <CardContent className="grid gap-3">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-2/3" />
                  <StatusLive aria-live="polite">Loading this submission…</StatusLive>
                </CardContent>
              </Card>
            </div>
            <aside data-slot="submission-rail" className="grid w-full shrink-0 gap-4 xl:w-[26rem]">
              <Card>
                <CardContent className="grid gap-3">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-full" />
                </CardContent>
              </Card>
            </aside>
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
              {decision === 'pending'
                ? 'Pending'
                : decision === 'accepted'
                  ? 'Accepted'
                  : 'Rejected'}
            </Badge>
            <Badge variant="ghost">Version {detail.version}</Badge>
          </PageHeaderActions>
        </PageHeader>
        {/* Proposal is a reading column (`max-w-3xl`), not a `1fr` track: a
            full-width first column parked Acceptance at the far right and left
            a 1500px empty card around short answers. The rail stays 26rem so
            an acceptance subject still fits on one line, and it sits next to
            the proposal instead of the viewport edge. */}
        <div
          data-slot="submission-canvas"
          className="flex flex-col gap-4 xl:flex-row xl:items-start"
        >
          <div data-slot="submission-proposal" className="grid min-w-0 w-full max-w-3xl gap-4">
            <ProposalCard
              slug={slug ?? ''}
              submissionId={detail.id}
              title={detail.title}
              abstract={answerText(detail.answers.abstract ?? '')}
              answers={answers}
              labelByFieldKey={labelByFieldKey}
            />
          </div>
          <aside
            data-slot="submission-rail"
            aria-label="Acceptance and review"
            className="grid w-full shrink-0 gap-4 xl:sticky xl:top-16 xl:w-[26rem]"
          >
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
          </aside>
        </div>
      </div>
    </AppShell>
  )
}

function ProposalCard({
  slug,
  submissionId,
  title,
  abstract,
  answers,
  labelByFieldKey,
}: {
  readonly slug: string
  readonly submissionId: string
  readonly title: string
  readonly abstract: string
  readonly answers: readonly (readonly [string, AnswerValue | null])[]
  readonly labelByFieldKey: ReadonlyMap<string, string>
}) {
  const [editing, setEditing] = useState(false)

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle level={2}>Proposal</CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={editing}
            aria-controls="session-content-editor"
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? 'Close editor' : 'Edit session content'}
          </Button>
        </CardAction>
      </CardHeader>
      {editing ? (
        <CardContent id="session-content-editor" className="border-b">
          <SessionContentEditor
            slug={slug}
            submissionId={submissionId}
            title={title}
            abstract={abstract}
          />
        </CardContent>
      ) : null}
      <CardContent>
        {answers.length === 0 ? (
          <EmptyState
            icon={<InboxIcon size={20} />}
            title="No answers were submitted"
            description="Every question on this form version was optional or hidden for this speaker, so the proposal arrived with nothing but its title."
          />
        ) : (
          <dl className="divide-y divide-border">
            {answers.map(([fieldKey, value]) => (
              <div key={fieldKey} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {labelByFieldKey.get(fieldKey) ?? 'Answer'}
                </dt>
                <dd className="text-[15px] leading-relaxed whitespace-pre-wrap text-foreground">
                  {answerText(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function SessionContentEditor({
  slug,
  submissionId,
  title,
  abstract,
}: {
  readonly slug: string
  readonly submissionId: string
  readonly title: string
  readonly abstract: string
}) {
  const client = useQueryClient()
  const [nextTitle, setNextTitle] = useState<string | null>(null)
  const [nextAbstract, setNextAbstract] = useState<string | null>(null)
  const titleValue = nextTitle ?? title
  const abstractValue = nextAbstract ?? abstract
  const [status, setStatus] = useState('approved')
  const revisions = useQuery({
    queryKey: ['admin', 'revisions', slug, submissionId],
    queryFn: () =>
      requestJson<readonly { id: string; editorName: string; title: string; createdAt: string }[]>(
        `/api/admin/events/${slug}/submissions/${submissionId}/revisions`,
      ),
  })
  const save = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${slug}/submissions/${submissionId}/content`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: titleValue,
          abstract: abstractValue,
          editorName: 'Jordan Alvarez',
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries()
    },
  })
  const restore = useMutation({
    mutationFn: (revisionId: string) =>
      requestJson(`/api/admin/events/${slug}/revisions/${revisionId}/restore`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void client.invalidateQueries()
    },
  })
  const approve = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${slug}/submissions/${submissionId}/content-status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void client.invalidateQueries()
    },
  })
  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel htmlFor="session-title">Session title</FieldLabel>
        <Input
          id="session-title"
          value={titleValue}
          onChange={(event) => setNextTitle(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="session-abstract">Abstract</FieldLabel>
        <Textarea
          id="session-abstract"
          value={abstractValue}
          onChange={(event) => setNextAbstract(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="session-content-status">Content status</FieldLabel>
        <NativeSelect
          id="session-content-status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="approved">Approved</option>
          <option value="draft">Draft</option>
        </NativeSelect>
      </Field>
      <ButtonGroup>
        <Button type="button" onClick={() => save.mutate()} pending={save.isPending}>
          Save session content
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => approve.mutate()}
          pending={approve.isPending}
        >
          Save content status
        </Button>
      </ButtonGroup>
      <ul className="grid gap-2 text-sm">
        {(revisions.data ?? []).map((revision) => (
          <li key={revision.id} className="flex min-w-0 items-start justify-between gap-2">
            <span className="min-w-0 break-words">
              {revision.createdAt} · {revision.editorName} · {revision.title}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => restore.mutate(revision.id)}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
