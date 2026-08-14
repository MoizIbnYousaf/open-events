import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { getApiErrorCode } from '../../api/admin-events'
import { publicDraftQueryKeys, type PublicEditorState } from '../../queries/public-drafts'
import type { SaveDenial } from './CfpSaveBar'
import { useSubmitCfp } from '../../queries/public-submissions'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { PaperStack } from '../../../components/ui/paper-stack'
import { TextLink } from '../../../components/ui/link'
import { StatusLive } from '../../../components/ui/status-live'

interface CfpSubmitProps {
  readonly formVersionId: string
  readonly onSubmitted?: () => void
  /**
   * Raised when the submit is refused for who the reader is rather than for
   * what they sent. Same contract as the save bar's: rendering a page state
   * from this slot put a second dead-end card and a second h1 under a wizard
   * that stayed editable, so the page answers instead — once, honestly.
   */
  readonly onDenied: (code: SaveDenial) => void
}

export default function CfpSubmit({ onSubmitted, onDenied }: CfpSubmitProps) {
  const queryClient = useQueryClient()
  const submit = useSubmitCfp()
  const [submitted, setSubmitted] = useState(false)
  const [submittedTitle, setSubmittedTitle] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    if (submitted) {
      headingRef.current?.focus()
    }
  }, [submitted])

  const code = getApiErrorCode(submit.error)
  const bannerCopy =
    code === 'cfp_closed'
      ? 'The call for papers is closed.'
      : code === 'cfp_capped'
        ? 'The submission cap has been reached.'
        : code === 'identity_limit_reached'
          ? 'You have already reached the submission limit for this call for papers.'
          : submit.isError
            ? 'Unable to submit your proposal.'
            : null

  if (submitted) {
    return (
      <Card className="mx-auto w-full max-w-[47rem]">
        <CardContent className="grid justify-items-center gap-2 py-8 text-center">
          <PaperStack className="mb-3" />
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-xl leading-tight font-semibold outline-hidden"
          >
            Submission received
          </h1>
          {/* One line under the title, not two saying the same thing. This
              panel printed "Your proposal is with the organizers." and then a
              live region reading "Submission received. Thank you for your
              proposal." — which repeated the h1 directly above it, so the
              emotional peak of the speaker journey stuttered. The region stays
              (it is the confirmation's programmatic signal, and the focused h1
              is what announces the outcome); what it carries is now the
              explanation rather than an echo of the title. */}
          {submittedTitle !== null && submittedTitle !== '' ? (
            <p className="max-w-sm text-sm">{submittedTitle}</p>
          ) : null}
          <StatusLive aria-live="polite" className="max-w-sm">
            Your proposal is with the organizers. Thank you for sending it.
          </StatusLive>
          {/* The end of the speaker's errand still needs a door. This card was
              the only surface in the product with nothing at all to press, and
              the portal is where the proposal they just sent is listed along
              with whatever the organizers ask for next.

              A plain anchor, not a router Link: this component renders in test
              harnesses and previews without a router around it, and a full load
              is the honest reset here anyway — the portal has to read the
              submission that has just been created. */}
          <TextLink href="/portal" className="mt-1">
            Track it in your speaker portal
          </TextLink>
        </CardContent>
      </Card>
    )
  }

  const draftId =
    queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)?.draftId ?? null
  const unsaved = draftId === null
  return (
    <div className="grid gap-3">
      {/* A control that is off for a reason the reader cannot see is a dead
          end with a cursor. The condition is server-derived — there is no
          saved draft to submit — so the button stays disabled and the sentence
          says what to press instead. It is bound with aria-describedby so the
          reason is read with the control, not left to be found by chance. */}
      {unsaved ? (
        <p id="cfp-submit-reason" className="text-sm text-muted-foreground">
          Save your draft first — Submit sends the proposal the organizers have on file.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {/* `pending` rather than a bare `disabled`: it is what puts aria-busy
            on the control the speaker actually pressed, and it still makes the
            control inert so the proposal cannot be submitted twice. The
            separate `disabled` is a different condition — there is nothing
            saved to submit — and must not claim to be in flight. */}
        <Button
          type="button"
          pending={submit.isPending}
          disabled={unsaved}
          aria-describedby={unsaved ? 'cfp-submit-reason' : undefined}
          onClick={() =>
            submit.mutate(undefined, {
              onSuccess: (detail) => {
                setSubmittedTitle(detail.title)
                setSubmitted(true)
                onSubmitted?.()
              },
              onError: (error) => {
                const denial = getApiErrorCode(error)
                if (denial === 'unauthorized' || denial === 'forbidden') onDenied(denial)
              },
            })
          }
        >
          {submit.isPending ? 'Submitting…' : 'Submit'}
        </Button>
        {/* aria-busy on a disabled control is not reliably announced, so the
            in-flight state also exists as a status message beside it. A stable
            region whose text changes, never one created together with its
            text — a live region has to be in the accessibility tree before its
            content arrives. */}
        <StatusLive aria-live="polite">
          {submit.isPending ? 'Submitting your proposal…' : null}
        </StatusLive>
      </div>
      {bannerCopy !== null ? <AlertLive>{bannerCopy}</AlertLive> : null}
    </div>
  )
}
