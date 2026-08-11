import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { getApiErrorCode } from '../../api/admin-events'
import { announce } from '../../lib/announcer'
import {
  publicDraftQueryKeys,
  recoverPublicSession,
  useSaveDraft,
  type PublicEditorState,
} from '../../queries/public-drafts'
import { ExpiredSessionState, ForbiddenState } from '../admin/AdminStates'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { StatusLive } from '../../../components/ui/status-live'

export default function CfpSaveBar() {
  const queryClient = useQueryClient()
  const router = useRouter({ warn: false })
  const save = useSaveDraft()
  const [reloadPending, setReloadPending] = useState(false)
  const code = getApiErrorCode(save.error)
  const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)

  if (code === 'unauthorized') {
    return (
      <ExpiredSessionState
        onLogin={() => recoverPublicSession(queryClient, editor?.formId ?? '', router)}
      />
    )
  }
  if (code === 'forbidden') {
    return <ForbiddenState />
  }
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
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        pending={save.isPending}
        onClick={() =>
          save.mutate(undefined, {
            // The failure renders its own alert with this exact sentence, so
            // only the success needs the announcer (DEC-014).
            onSuccess: () => announce('Draft saved'),
          })
        }
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
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
