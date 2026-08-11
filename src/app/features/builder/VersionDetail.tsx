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
import AppShell from '../nav/AppShell'
import { AlertLive } from '../../../components/ui/alert-live'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'

export default function VersionDetail() {
  return <VersionDetailScreen />
}

function VersionDetailScreen() {
  const params = useParams({ strict: false })
  const formId = params.formId as string | undefined
  const eventSlug = params.slug as string | undefined
  const versionId = params.versionId as string | undefined
  const detailQuery = useFormVersionDetail(eventSlug, formId, versionId)
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
        pending={detailQuery.isFetching}
        onRetry={() => void detailQuery.refetch()}
      />
    )
  }

  if (detailQuery.isPending || detailQuery.data === undefined) {
    return (
      <AppShell slug={eventSlug ?? ''}>
        <Card aria-busy="true" aria-label="Loading version">
          <CardContent className="grid gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <StatusLive aria-live="polite">Loading version…</StatusLive>
          </CardContent>
        </Card>
      </AppShell>
    )
  }

  const detail = detailQuery.data
  return (
    <AppShell slug={eventSlug ?? ''}>
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
                {detail.elements.map((element) =>
                  element.pageId === page.id ? (
                    <p key={element.id} className="text-sm">
                      {element.label ?? ''}
                    </p>
                  ) : null,
                )}
              </section>
            ))}
          </CardContent>
        </Card>
        {/* Exact matching, or the builder path prefix-matches this version page
          and the back link is announced as the current page. */}
        <Link
          to="/admin/events/$slug/forms/$formId"
          params={{ slug: eventSlug ?? '', formId: formId ?? '' }}
          activeOptions={{ exact: true }}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Back to builder
        </Link>
      </div>
    </AppShell>
  )
}
