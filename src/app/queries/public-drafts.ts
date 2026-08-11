import { useRef } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'
import type { AnyRouter } from '@tanstack/react-router'

import { getActiveDraft, saveDraft } from '../api/public'
import type { DraftDto, SaveDraftInput } from '../../application'
import type { AnswerMap } from '../../domain'

export const publicDraftQueryKeys = {
  activeDraft: (formId: string) => ['public', 'draft', formId] as const,
  /** Single mounted public editor cache: answers/title/draft id + form identity. */
  editor: ['public', 'editor'] as const,
}

/** One editable co-speaker row kept in the shared editor cache. */
export type CoSpeakerDraft = {
  /** Stable render identity; never sent to the API. */
  readonly clientId: string
  readonly firstName: string
  readonly lastName: string
  readonly email: string
}

export interface PublicEditorState {
  readonly formId: string
  readonly formVersionId: string
  readonly draftId: string | null
  readonly title: string
  readonly answers: AnswerMap
  readonly dirty: boolean
  /** Transient reload intent: armed by CfpSaveBar before a draft refetch. */
  readonly reloadIntent: boolean
  /** Co-speaker rows; client-editor state only (never part of a draft PUT). */
  readonly coSpeakers: readonly CoSpeakerDraft[]
}

export function useActiveDraft(formId: string) {
  return useQuery({
    queryKey: publicDraftQueryKeys.activeDraft(formId),
    queryFn: () => getActiveDraft(formId),
    // A reload must always produce a new data reference so the wizard's
    // hydration effect (the query-completion signal) re-runs with server data.
    structuralSharing: false,
  })
}

export function usePublicEditor(formId: string, formVersionId: string) {
  return useQuery({
    queryKey: publicDraftQueryKeys.editor,
    // The editor is explicitly mutated/hydrated; never refetch the
    // initializer (a new observer, e.g. CfpCoSpeakers on the submit step,
    // would wipe saved editor state).
    staleTime: Infinity,
    queryFn: () =>
      ({
        formId,
        formVersionId,
        draftId: null,
        title: '',
        answers: {},
        dirty: false,
        reloadIntent: false,
        coSpeakers: [],
      }) as PublicEditorState,
  })
}

export function useSaveDraft() {
  const queryClient = useQueryClient()
  // What the PUT carried, captured as it left. A save is a round trip and a
  // speaker keeps writing across it: acknowledging the server's copy wholesale
  // threw away every keystroke made while the request was in flight, which is
  // the one moment a speaker is most likely to still be typing.
  const sent = useRef<{ readonly title: string; readonly answers: AnswerMap } | null>(null)
  return useServerMutation({
    mutationFn: () => {
      const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
      if (editor === undefined) {
        throw new Error('Editor state is not initialized')
      }
      const input: SaveDraftInput = {
        id: editor.draftId,
        formId: editor.formId,
        formVersionId: editor.formVersionId,
        title: editor.title,
        answers: editor.answers,
      }
      sent.current = { title: editor.title, answers: editor.answers }
      return saveDraft(input)
    },
    onSuccess: (draft: DraftDto) => {
      const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
      if (editor === undefined) return
      // MERGE, never overwrite: anything the editor holds that is not what the
      // PUT sent was typed after it left, so it is newer than the answer coming
      // back and it wins. Identity comparison is exact here because every
      // editor write replaces the object it changes.
      const inFlight = sent.current
      sent.current = null
      const titleAhead = inFlight !== null && editor.title !== inFlight.title
      const answersAhead = inFlight !== null && editor.answers !== inFlight.answers
      queryClient.setQueryData(publicDraftQueryKeys.activeDraft(editor.formId), draft)
      queryClient.setQueryData(publicDraftQueryKeys.editor, {
        ...editor,
        draftId: draft.id,
        title: titleAhead ? editor.title : draft.title,
        answers: answersAhead ? editor.answers : draft.answers,
        // Still dirty when the speaker is ahead of the server: what they typed
        // during the save has not been stored by anyone yet.
        dirty: titleAhead || answersAhead,
      })
    },
    retry: false,
  })
}

/**
 * Recovery for an expired public session: remove ONLY the shared editor and
 * this form's active-draft keys, then (when a router is present) navigate to
 * the public start path. Never clears the whole cache or removes by prefix.
 */
export function recoverPublicSession(
  queryClient: QueryClient,
  formId: string,
  router: AnyRouter | null | undefined,
): void {
  queryClient.removeQueries({ queryKey: publicDraftQueryKeys.editor, exact: true })
  queryClient.removeQueries({ queryKey: publicDraftQueryKeys.activeDraft(formId), exact: true })
  if (router != null) {
    void router.navigate({ to: '/start' })
  }
}
