import { useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import { submitCfp } from '../api/public'
import type { SubmitInput } from '../../application/dtos/submission.dto'
import { normalizeEmail } from '../../domain/invariants/email'
import { publicDraftQueryKeys, type PublicEditorState } from './public-drafts'

/** Submit the saved draft once; success clears the editor draft/co-speakers. */
export function useSubmitCfp() {
  const queryClient = useQueryClient()
  return useServerMutation({
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
        coSpeakers: editor.coSpeakers.reduce<Array<{ name: string; email: string }>>(
          (rows, row) => {
            const email = normalizeEmail(row.email)
            if (email !== '') {
              rows.push({
                name: [row.firstName.trim(), row.lastName.trim()].filter(Boolean).join(' '),
                email,
              })
            }
            return rows
          },
          [],
        ),
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
