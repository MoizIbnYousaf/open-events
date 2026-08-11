import { useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import type { AnswerValue } from '../../../domain'
import { getApiErrorCode } from '../../api/admin-events'
import { useAcceptancePreview } from '../../queries/admin-communications'
import { useFormVersionDetail } from '../../queries/admin-forms'
import { useSubmissionDetail } from '../../queries/admin-submissions'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import CommunicationsPanel from './CommunicationsPanel'
import AppShell from '../nav/AppShell'
import { DeniedState, ExpiredSessionState } from './AdminStates'
import EvaluationPanel from './EvaluationPanel'

function answerText(value: AnswerValue | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
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
  // Acceptance is a record, not a status column, so the badge reads the
  // acceptance state. Same query key as the panel below: one request, one
  // source of truth.
  const acceptanceQuery = useAcceptancePreview(slug, submissionId)
  const accepted = acceptanceQuery.data?.accepted === true
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    document.title = 'Submission — SpeakerOps'
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

  const denialCode = getApiErrorCode(detailQuery.error) ?? getApiErrorCode(versionQuery.error)
  if (detail === null || denialCode === 'forbidden' || denialCode === 'not_found') {
    return <DeniedState />
  }
  if (denialCode === 'unauthorized') {
    return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
  }
  if (detailQuery.isError || versionQuery.isError) {
    return (
      <Card>
        <CardContent className="grid gap-3">
          <AlertLive>Unable to load this submission.</AlertLive>
          <Button
            variant="outline"
            pending={versionQuery.isFetching || detailQuery.isFetching}
            onClick={() =>
              void (versionQuery.isError ? versionQuery.refetch() : detailQuery.refetch())
            }
          >
            {versionQuery.isFetching || detailQuery.isFetching ? 'Trying again…' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (detail === undefined || version === undefined) {
    return (
      <AppShell slug={slug ?? ''}>
        <div className="grid gap-4" aria-busy="true" aria-label="Loading this submission">
          <Skeleton className="h-8 w-48" />
          <Card>
            <CardContent className="grid gap-3">
              <Skeleton className="h-24 w-full" />
              <StatusLive aria-live="polite">Loading this submission…</StatusLive>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell slug={slug ?? ''}>
      <div className="grid gap-4">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          {detail.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{accepted ? 'Accepted' : 'Pending'}</Badge>
          <p className="text-sm text-muted-foreground">Version {detail.version}</p>
        </div>
        <Card>
          <CardContent>
            <dl className="grid gap-2">
              {Object.entries(detail.answers).map(([fieldKey, value]) => (
                <div key={fieldKey} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
                  <dt className="text-sm font-medium">
                    {labelByFieldKey.get(fieldKey) ?? 'Answer'}
                  </dt>
                  <dd className="text-sm">{answerText(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
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
        {/* Exact matching, or the list path prefix-matches this detail page and
          the back link is announced as the current page. */}
        <Link
          to="/admin/events/$slug/submissions"
          params={{ slug: slug ?? '' }}
          activeOptions={{ exact: true }}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to submissions
        </Link>
      </div>
    </AppShell>
  )
}
