import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'
import type { SubmissionDetailDto } from '../../application'
import type { AnswerMap, SubmissionStatus } from '../../domain'
import { ApiClientError, requestJson } from '../api/admin-events'

/**
 * One speaker-portal row: the list item the API returns for the signed-in
 * speaker's own submission. Heavy detail (answers) never reaches this surface.
 *
 * `status` uses the domain vocabulary, which has exactly one member: the
 * persisted status never changes. Acceptance is a separate record, so it
 * travels as `accepted` and is the only decision this surface can render.
 */
export interface PortalSubmission {
  readonly id: string
  readonly title: string
  readonly status: SubmissionStatus
  readonly accepted: boolean
  /**
   * Whether the invite route can render an .ics right now. Acceptance alone is
   * not enough: an event with no configured dates answers 409, and a
   * `download` anchor would save that error envelope to disk as the .ics.
   */
  readonly inviteAvailable: boolean
  readonly formSlug: string
  readonly version: number
  readonly coSpeakerCount: number
  readonly submittedAt: string
}

interface PortalSubmissionsEnvelope {
  readonly submissions: readonly PortalSubmission[]
}

/**
 * GET /api/public/submissions — the signed-in speaker's own submissions.
 * A 401 (no session) maps to null so the page can hand the visitor to /start;
 * every other failure is re-thrown as generic copy so raw server text never
 * reaches the UI.
 */
export async function getOwnSubmissions(): Promise<readonly PortalSubmission[] | null> {
  try {
    const envelope = await requestJson<PortalSubmissionsEnvelope>('/api/public/submissions')
    return envelope.submissions
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null
    throw new Error('Your submissions are unavailable right now.', { cause: error })
  }
}

export const portalQueryKeys = {
  ownSubmissions: () => ['portal', 'own-submissions'] as const,
}

export function useOwnSubmissions() {
  return useQuery({
    queryKey: portalQueryKeys.ownSubmissions(),
    queryFn: getOwnSubmissions,
    retry: false,
  })
}

/**
 * GET /api/public/submission/:id — one own submission in full, including every
 * answer and the server's verdict on whether it may still be edited.
 *
 * The portal list carries a title and a status; revising a proposal needs the
 * answers themselves, and there is no reason to ship them to a speaker who is
 * only glancing at the list. Enabled only once a row is opened.
 */
export async function getOwnSubmission(id: string): Promise<SubmissionDetailDto> {
  return requestJson<SubmissionDetailDto>(`/api/public/submission/${encodeURIComponent(id)}`)
}

export function useOwnSubmission(id: string | null) {
  return useQuery({
    queryKey: ['portal', 'own-submission', id ?? ''] as const,
    queryFn: () => getOwnSubmission(id as string),
    enabled: id !== null,
    retry: false,
  })
}

/** PUT /api/public/submission/:id — revise an own proposal while the call is open. */
export function useEditOwnSubmission(id: string) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (input: { readonly title: string; readonly answers: AnswerMap }) =>
      requestJson<SubmissionDetailDto>(`/api/public/submission/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: (updated: SubmissionDetailDto) => {
      queryClient.setQueryData(['portal', 'own-submission', id] as const, updated)
      // The list row shows the title, which an edit can change.
      void queryClient.invalidateQueries({ queryKey: portalQueryKeys.ownSubmissions() })
    },
  })
}
