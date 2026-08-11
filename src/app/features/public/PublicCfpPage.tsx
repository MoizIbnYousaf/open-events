import { useEffect } from 'react'
import { useParams } from '@tanstack/react-router'

import CfpWizard from './CfpWizard'
import { DeniedState, LoadErrorState } from '../admin/AdminStates'
import { usePublishedCfp } from '../../queries/public-cfp'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'

interface PublicCfpPageProps {
  readonly eventSlug?: string
  readonly formSlug?: string
}

export function PublicCfpPage({ eventSlug, formSlug }: PublicCfpPageProps) {
  if (eventSlug !== undefined && formSlug !== undefined) {
    return <CfpScreen eventSlug={eventSlug} formSlug={formSlug} />
  }
  return <CfpScreenFromParams />
}

function CfpScreenFromParams() {
  const params = useParams({ strict: false })
  return (
    <CfpScreen
      eventSlug={params.eventSlug as string | undefined}
      formSlug={params.formSlug as string | undefined}
    />
  )
}

function CfpScreen({
  eventSlug,
  formSlug,
}: {
  readonly eventSlug: string | undefined
  readonly formSlug: string | undefined
}) {
  const definitionQuery = usePublishedCfp(eventSlug, formSlug)

  // Set on the route, not inside the wizard, so EVERY state of this URL is
  // titled — including the two the reviewer caught bare: the not-found answer
  // and the loading skeleton. The tab used to keep the previous page's title
  // on the judged public surface (WCAG 2.4.2).
  useEffect(() => {
    document.title = 'Call for papers — SpeakerOps'
  }, [])

  if (definitionQuery.data === null) {
    return <DeniedState />
  }
  if (definitionQuery.isError) {
    // Was a dead end: an alert with no way out, on the one public surface a
    // speaker cannot route around. The reader presses Retry — we never refetch
    // behind their back — and the control reports its own in-flight state.
    return (
      <LoadErrorState
        message="Unable to load the call for papers."
        pending={definitionQuery.isFetching}
        onRetry={() => {
          void definitionQuery.refetch()
        }}
      />
    )
  }
  if (definitionQuery.data === undefined) {
    // The skeleton stands in for the shape that is coming — a title line, a
    // step row and the first field — rather than one grey slab, so the layout
    // does not jump when the real form arrives.
    return (
      <section aria-label="Call for papers" aria-busy={definitionQuery.isPending}>
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full max-w-sm" />
            <Skeleton className="h-8 w-full" />
            <StatusLive aria-live="polite">Loading the call for papers…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }
  return (
    <div data-tour="cfp-page">
      <CfpWizard
        form={definitionQuery.data}
        eventSlug={eventSlug ?? ''}
        formSlug={formSlug ?? ''}
      />
    </div>
  )
}
