import { useParams } from '@tanstack/react-router'

import CfpWizard from './CfpWizard'
import { DeniedState } from '../admin/AdminStates'
import { usePublishedCfp } from '../../queries/public-cfp'
import { AlertLive } from '../../../components/ui/alert-live'
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

  if (definitionQuery.data === null) {
    return <DeniedState />
  }
  if (definitionQuery.isError) {
    return (
      <Card>
        <CardContent className="grid gap-3">
          <AlertLive>Unable to load the call for papers.</AlertLive>
        </CardContent>
      </Card>
    )
  }
  if (definitionQuery.data === undefined) {
    return (
      <section aria-label="Call for papers" aria-busy={definitionQuery.isPending}>
        <Card>
          <CardContent>
            <Skeleton className="h-10 w-full" />
            <StatusLive>Loading the call for papers…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }
  return (
    <CfpWizard form={definitionQuery.data} eventSlug={eventSlug ?? ''} formSlug={formSlug ?? ''} />
  )
}
