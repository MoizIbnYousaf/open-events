import { useEffect } from 'react'
import { useParams } from '@tanstack/react-router'

import type { FormDefinitionDto } from '../../../application'
import CfpWizard from './CfpWizard'
import { DeniedState, LoadErrorState, PageState } from '../admin/AdminStates'
import { usePublishedCfp } from '../../queries/public-cfp'
import { buttonVariants } from '../../../components/ui/button-variants'
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
  // A closed call is not a form with a disabled button: there is nothing to fill
  // in, and offering the wizard anyway would invite four steps of work the server
  // will refuse. The verdict comes from the server so this page and the submit
  // gate cannot disagree about what "closed" means.
  if (definitionQuery.data.submissionState !== 'open') {
    return <ClosedCallState definition={definitionQuery.data} />
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

const windowFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'UTC',
  dateStyle: 'long',
  timeStyle: 'short',
})

function formatWindowInstant(iso: string): string | null {
  try {
    return `${windowFormatter.format(new Date(iso))} UTC`
  } catch {
    return null
  }
}

/**
 * The call is not accepting proposals — either the deadline has passed or it has
 * not opened yet. Both are one honest page state naming the date, because a
 * visitor turned away deserves to know which side of the window they are on.
 *
 * One h1, and no path into the form: the whole point is that there is nothing to
 * start here.
 */
function ClosedCallState({ definition }: { readonly definition: FormDefinitionDto }) {
  const closed = definition.submissionState === 'closed'
  const instant = closed ? definition.closesAt : definition.opensAt
  const readable = instant === null ? null : formatWindowInstant(instant)
  return (
    <div className="mx-auto grid w-full max-w-[47rem] gap-5">
      <PageState
        title={closed ? 'Submissions are closed' : 'Submissions are not open yet'}
        message={
          closed
            ? readable === null
              ? 'The call for papers has closed and is no longer accepting proposals.'
              : `The call for papers closed on ${readable} and is no longer accepting proposals.`
            : readable === null
              ? 'The call for papers has not opened yet.'
              : `The call for papers opens on ${readable}.`
        }
        action={
          <a href="/schedule/demo-conf-2026" className={buttonVariants({ variant: 'outline' })}>
            See the public programme
          </a>
        }
      />
    </div>
  )
}
