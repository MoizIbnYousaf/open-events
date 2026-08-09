import { useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import type { AnswerValue } from '../../../domain'
import { getApiErrorCode } from '../../api/admin-events'
import { useFormVersionDetail } from '../../queries/admin-forms'
import { useSubmissionDetail } from '../../queries/admin-submissions'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { DeniedState, ExpiredSessionState } from './AdminStates'

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
  const versionQuery = useFormVersionDetail(detail?.formId, detail?.versionId)
  const version = versionQuery.data
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
            onClick={() =>
              void (versionQuery.isError ? versionQuery.refetch() : detailQuery.refetch())
            }
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (detail === undefined || version === undefined) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent>
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">
        {detail.title}
      </h1>
      <div className="flex flex-wrap items-center gap-3">
        <Badge>Pending</Badge>
        <p className="text-sm text-muted-foreground">Version {detail.version}</p>
      </div>
      <Card>
        <CardContent>
          <dl className="grid gap-2">
            {Object.entries(detail.answers).map(([fieldKey, value]) => (
              <div key={fieldKey} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
                <dt className="text-sm font-medium">{labelByFieldKey.get(fieldKey) ?? 'Answer'}</dt>
                <dd className="text-sm">{answerText(value)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Link
        to="/admin/events/$slug/submissions"
        params={{ slug: slug ?? '' }}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to submissions
      </Link>
    </div>
  )
}
