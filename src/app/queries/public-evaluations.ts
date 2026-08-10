import { useMutation, useQuery } from '@tanstack/react-query'

import { ApiClientError, requestJson } from '../api/admin-events'

/** One evaluation row: labels only, never emails/contact ids. */
export interface EvaluationRow {
  readonly submissionId: string
  readonly sessionTitle: string
  readonly rating: number
  readonly comments: string
  readonly updatedAt: string
}

export interface SubmitEvaluationInput {
  readonly submissionId: string
  readonly rating: number
  readonly comments?: string
}

/**
 * GET /api/public/evaluations — the evaluator's evaluation rows. A 404 maps
 * to null helper-locally (committed public-helper pattern); 401/403/5xx
 * propagate through the ApiClientError seam.
 */
export async function getPublicEvaluations(): Promise<readonly EvaluationRow[] | null> {
  try {
    return await requestJson<readonly EvaluationRow[]>('/api/public/evaluations')
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null
    throw error
  }
}

/** POST /api/public/evaluations — idempotent upsert, credentials via requestJson. */
export function submitEvaluation(input: SubmitEvaluationInput): Promise<EvaluationRow> {
  return requestJson<EvaluationRow>('/api/public/evaluations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export const publicEvaluationsQueryKeys = {
  all: ['public', 'evaluations'] as const,
}

export function usePublicEvaluations() {
  return useQuery({
    queryKey: publicEvaluationsQueryKeys.all,
    queryFn: getPublicEvaluations,
    retry: false,
  })
}

export function useSubmitEvaluation() {
  return useMutation({ mutationFn: submitEvaluation, retry: false })
}
