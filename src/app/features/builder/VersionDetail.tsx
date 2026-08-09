import { useEffect } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import { useFormVersionDetail } from '../../queries/admin-forms'
import {
  DeniedState,
  ExpiredSessionState,
  ForbiddenState,
  LoadErrorState,
} from '../admin/AdminStates'
import { AlertLive } from '../../../components/ui/alert-live'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'

export default function VersionDetail() {
  return <VersionDetailScreen />
}

function VersionDetailScreen() {
  const params = useParams({ strict: false })
  const formId = params.formId as string | undefined
  const versionId = params.versionId as string | undefined
  const detailQuery = useFormVersionDetail(formId, versionId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    document.title = 'Version detail — SpeakerOps'
  }, [])

  if (detailQuery.isError) {
    const code = getApiErrorCode(detailQuery.error)
    if (code === 'forbidden') return <ForbiddenState />
    if (code === 'not_found') return <DeniedState />
    if (code === 'unauthorized') {
      return (
        <ExpiredSessionState
          onLogin={() => {
            queryClient.clear()
            void navigate({ to: '/admin' })
          }}
        />
      )
    }
    return (
      <LoadErrorState
        message={getApiErrorMessage(detailQuery.error, 'Unable to load the version')}
        onRetry={() => void detailQuery.refetch()}
      />
    )
  }

  if (detailQuery.isPending || detailQuery.data === undefined) {
    return (
      <Card aria-busy="true" aria-label="Loading version">
        <CardContent className="grid gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>
    )
  }

  const detail = detailQuery.data
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <h1 className="font-heading text-base leading-snug font-medium">
            Version {detail.version}
          </h1>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Status: {detail.status === 'published' ? 'Published' : 'Draft'}
          </p>
          {detail.status === 'published' ? (
            <AlertLive>This version is frozen and cannot be edited.</AlertLive>
          ) : null}
          {detail.pages.map((page) => (
            <section key={page.id} className="grid gap-2">
              <h2 className="text-base font-semibold">{page.title}</h2>
              {detail.elements
                .filter((element) => element.pageId === page.id)
                .map((element) => (
                  <p key={element.id} className="text-sm">
                    {element.label ?? ''}
                  </p>
                ))}
            </section>
          ))}
        </CardContent>
      </Card>
      <Link
        to="/admin/forms/$formId"
        params={{ formId: formId ?? '' }}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to builder
      </Link>
    </div>
  )
}
