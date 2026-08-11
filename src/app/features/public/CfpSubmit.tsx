import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { getApiErrorCode } from '../../api/admin-events'
import {
  publicDraftQueryKeys,
  recoverPublicSession,
  type PublicEditorState,
} from '../../queries/public-drafts'
import { useSubmitCfp } from '../../queries/public-submissions'
import { ExpiredSessionState, ForbiddenState } from '../admin/AdminStates'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { StatusLive } from '../../../components/ui/status-live'

interface CfpSubmitProps {
  readonly formId: string
  readonly formVersionId: string
  readonly onSubmitted?: () => void
}

export default function CfpSubmit({ formId, onSubmitted }: CfpSubmitProps) {
  const queryClient = useQueryClient()
  const router = useRouter({ warn: false })
  const submit = useSubmitCfp()
  const [submitted, setSubmitted] = useState(false)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    if (submitted) {
      headingRef.current?.focus()
    }
  }, [submitted])

  const code = getApiErrorCode(submit.error)
  if (code === 'unauthorized') {
    return <ExpiredSessionState onLogin={() => recoverPublicSession(queryClient, formId, router)} />
  }
  if (code === 'forbidden') {
    return <ForbiddenState />
  }
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
      <div className="grid gap-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          Submission received
        </h1>
        <StatusLive aria-live="polite">
          Submission received. Thank you for your proposal.
        </StatusLive>
      </div>
    )
  }

  const draftId =
    queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)?.draftId ?? null
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* `pending` rather than a bare `disabled`: it is what puts aria-busy
            on the control the speaker actually pressed, and it still makes the
            control inert so the proposal cannot be submitted twice. The
            separate `disabled` is a different condition — there is nothing
            saved to submit — and must not claim to be in flight. */}
        <Button
          type="button"
          pending={submit.isPending}
          disabled={draftId === null}
          onClick={() =>
            submit.mutate(undefined, {
              onSuccess: () => {
                setSubmitted(true)
                onSubmitted?.()
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
