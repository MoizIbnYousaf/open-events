import { useQuery } from '@tanstack/react-query'

import { ApiClientError, requestJson } from '../api/admin-events'

/**
 * One speaker-portal row: the list item the API returns for the signed-in
 * speaker's own submission. Heavy detail (answers) never reaches this surface.
 */
export interface PortalSubmission {
  readonly id: string
  readonly title: string
  readonly status: string
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
