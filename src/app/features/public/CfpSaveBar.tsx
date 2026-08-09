import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { getApiErrorCode } from '../../api/admin-events'
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
    save.reset()
    const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
    if (editor !== undefined) {
      queryClient.setQueryData(publicDraftQueryKeys.editor, { ...editor, reloadIntent: true })
      void queryClient.refetchQueries({
        queryKey: publicDraftQueryKeys.activeDraft(editor.formId),
      })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        disabled={save.isPending}
        aria-label={save.isPending ? 'Saving…' : 'Save'}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
      {save.isSuccess ? <StatusLive>Saved</StatusLive> : null}
      {conflict ? (
        <>
          <AlertLive>The draft changed elsewhere — reload to see the latest</AlertLive>
          <Button type="button" variant="outline" onClick={reloadLatest}>
            Reload latest
          </Button>
        </>
      ) : null}
      {save.isError && !conflict ? <AlertLive>Unable to save your draft.</AlertLive> : null}
    </div>
  )
}
