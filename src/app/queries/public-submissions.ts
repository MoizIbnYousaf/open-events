import { useMutation, useQueryClient } from '@tanstack/react-query'

import { submitCfp } from '../api/public'
import type { SubmitInput } from '../../application'
import { normalizeEmail } from '../../domain'
import { publicDraftQueryKeys, type PublicEditorState } from './public-drafts'

/** Submit the saved draft once; success clears the editor draft/co-speakers. */
export function useSubmitCfp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => {
      const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
      if (editor === undefined) {
        throw new Error('Editor state is not initialized')
      }
      if (editor.draftId === null) {
        throw new Error('A draft must be saved before submitting')
      }
      const input: SubmitInput = {
        originDraftId: editor.draftId,
        formVersionId: editor.formVersionId,
        title: editor.title,
        answers: editor.answers,
        coSpeakers: editor.coSpeakers
          .map((row) => ({
            name: [row.firstName.trim(), row.lastName.trim()].filter(Boolean).join(' '),
            email: normalizeEmail(row.email),
          }))
          .filter((row) => row.email !== ''),
      }
      return submitCfp(input)
    },
    onSuccess: () => {
      const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
      if (editor === undefined) return
      queryClient.setQueryData(publicDraftQueryKeys.editor, {
        ...editor,
        draftId: null,
        dirty: false,
        coSpeakers: [],
      })
      queryClient.setQueryData(publicDraftQueryKeys.activeDraft(editor.formId), null)
    },
    retry: false,
  })
}
