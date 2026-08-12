import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { getApiErrorCode } from '../../api/admin-events'
import {
  publicDraftQueryKeys,
  useSaveDraft,
  type PublicEditorState,
} from '../../queries/public-drafts'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { cn } from '../../../lib/utils'
import { StatusLive } from '../../../components/ui/status-live'

/** The two refusals a save can come back with that the PAGE has to answer. */
export type SaveDenial = 'unauthorized' | 'forbidden'

interface CfpSaveBarProps {
  /** Rendered when the step has somewhere to go back to. */
  readonly onBack?: () => void
  /** Rendered when the step has a next step; absent on the final step. */
  readonly onNext?: () => void
  /**
   * Raised when the save is refused for who the reader is rather than for what
   * they wrote. The bar has no business answering that: it is a row at the
   * bottom of a reading column, and a page state rendered into it is a second
   * dead-end card with a second h1 sitting under a wizard that is still
   * editable and can no longer save anything. The page decides instead.
   */
  readonly onDenied: (code: SaveDenial) => void
  /**
   * Raised the moment a save begins, so the page can retire any wizard-level
   * announcement of its own before this bar's region speaks. Two polite regions
   * holding text at once is the thing DEC-014 forbids, and the resumed-draft
   * notice would otherwise still be sitting there saying "Draft restored" while
   * this one says "Saved".
   */
  readonly onSaveStart?: () => void
}

/**
 * The step's one action bar: Back, Save and Next together.
 *
 * They used to bracket the content card — Next above it inside the stepper,
 * Save below it — so a speaker looking for "what do I press now" had to look in
 * two places for one step's controls. One row owns the step's progression and
 * its safety.
 *
 * It sticks to the bottom of the reading column while there is a Next, because
 * Save is the control a speaker reaches for most and the one they should never
 * have to scroll back to. On the final step there is no Next and the last
 * control on the page is Submit, below the co-speakers card: a bar pinned to
 * the viewport floor would sit on top of it, so there the row stays in flow.
 * Safe-area padding keeps it clear of a phone's home indicator.
 */
export default function CfpSaveBar({ onBack, onNext, onDenied, onSaveStart }: CfpSaveBarProps) {
  const queryClient = useQueryClient()
  const save = useSaveDraft()
  const [reloadPending, setReloadPending] = useState(false)
  const code = getApiErrorCode(save.error)
  const conflict = code === 'conflict'

  const reloadLatest = () => {
    if (reloadPending) return
    setReloadPending(true)
    save.reset()
    const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
    if (editor !== undefined) {
      queryClient.setQueryData(publicDraftQueryKeys.editor, { ...editor, reloadIntent: true })
      void queryClient
        .refetchQueries({ queryKey: publicDraftQueryKeys.activeDraft(editor.formId) })
        .finally(() => setReloadPending(false))
      return
    }
    setReloadPending(false)
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-t border-border bg-background py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        onNext !== undefined && 'sticky bottom-0 z-10',
      )}
    >
      {onBack !== undefined ? (
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        pending={save.isPending}
        onClick={() => {
          onSaveStart?.()
          // No onSuccess announcement: the StatusLive below is a live
          // region and already says "Saved", and the failure renders its own
          // alert. One region per outcome (DEC-014, F-R3-13).
          save.mutate(undefined, {
            onError: (error) => {
              const denial = getApiErrorCode(error)
              if (denial === 'unauthorized' || denial === 'forbidden') onDenied(denial)
            },
          })
        }}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
      {onNext !== undefined ? (
        <Button type="button" onClick={onNext}>
          Next
        </Button>
      ) : null}
      {/* One stable region for both, mounted before either has anything to
          say: a live region created together with its text is not in the
          accessibility tree when the text arrives, so it announces nothing.
          isSuccess is false while the save is in flight, so the two never
          compete for it. */}
      <StatusLive aria-live="polite">
        {save.isPending ? 'Saving your draft…' : save.isSuccess ? 'Saved' : null}
      </StatusLive>
      {conflict ? (
        <>
          <AlertLive>The draft changed elsewhere — reload to see the latest</AlertLive>
          <Button type="button" variant="outline" pending={reloadPending} onClick={reloadLatest}>
            {reloadPending ? 'Reloading…' : 'Reload latest'}
          </Button>
        </>
      ) : null}
      {save.isError && !conflict ? <AlertLive>Unable to save your draft.</AlertLive> : null}
    </div>
  )
}
