import { useEffect } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
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
import BackLink from '../nav/BackLink'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { DocumentIcon } from '../../../components/ui/icons'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
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
          <CardContent className="grid gap-2.5">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-48" />
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
        {/* Exact matching, or the builder path prefix-matches this version
            page and the back link is announced as the current page. */}
        <BackLink
          to="/admin/events/$slug/forms/$formId"
          params={{ slug: eventSlug ?? '', formId: formId ?? '' }}
          activeOptions={{ exact: true }}
        >
          Back to builder
        </BackLink>
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Version {detail.version}</PageHeaderTitle>
          </PageHeaderContent>
          <PageHeaderActions>
            {/* The same version state the builder list names, wearing the same
                marker — a chip that changes face between two screens showing
                one fact is a chip nobody can learn. */}
            <Badge dot variant={detail.status === 'published' ? 'secondary' : 'outline'}>
              {detail.status === 'published' ? 'Published' : 'Draft'}
            </Badge>
          </PageHeaderActions>
        </PageHeader>
        {detail.status === 'published' ? (
          // Informational, not a failure: a calm inline notice, because being
          // frozen is what a published version is FOR. It stays a live region
          // as authored.
          <AlertLive className="rounded-md border-l-0 bg-muted p-3 pl-3 text-sm text-muted-foreground">
            This version is frozen and cannot be edited.
          </AlertLive>
        ) : null}
        {detail.pages.length === 0 ? (
          <EmptyState
            icon={<DocumentIcon size={20} />}
            title="Nothing was captured in this version"
            description="This version was published with no pages, so speakers saw an empty form."
          />
        ) : null}
        {detail.pages.map((page) => (
          <section key={page.id}>
            <Card>
              <CardHeader>
                <CardTitle level={2}>{page.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="-my-1 divide-y divide-border">
                  {detail.elements.map((element) =>
                    element.pageId === page.id ? (
                      <li key={element.id} className="grid gap-0.5 py-1.5">
                        <span className="text-sm font-medium">{element.label ?? ''}</span>
                        <span className="text-xs text-muted-foreground">
                          {element.fieldKey ?? 'no field key'} ·{' '}
                          {element.questionType ?? element.kind}
                        </span>
                      </li>
                    ) : null,
                  )}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))}
      </div>
    </AppShell>
  )
}
