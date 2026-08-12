import { useQuery } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'

import { ApiClientError, requestJson } from '../api/admin-events'

/** What this evaluator recorded in a round that is behind them. */
export interface EvaluationPreviousRound {
  readonly roundNumber: number
  readonly roundName: string
  readonly rating: number
  readonly comments: string | null
  readonly updatedAt: string
}

/**
 * One evaluation row: labels only, never emails/contact ids. `rating`,
 * `comments` and `updatedAt` are null exactly while this round is unscored,
 * so the surface can say 'not yet scored' instead of showing a rating of 0.
 */
export interface EvaluationRow {
  readonly submissionId: string
  readonly sessionTitle: string
  readonly roundId: string
  readonly roundNumber: number
  readonly roundName: string
  readonly roundStatus: 'open' | 'closed'
  readonly rating: number | null
  readonly comments: string | null
  readonly updatedAt: string | null
  readonly previousRounds: readonly EvaluationPreviousRound[]
  /**
   * The round's own questions, when it has any. Absent on a round using the
   * single rating it always had, which is how the form knows which of the two
   * it is rendering.
   */
  readonly criteria?: readonly EvaluationRowCriterion[]
  /** Whose proposal this is — absent in a blind round, where nobody may know. */
  readonly speakerName?: string | null
  readonly anonymized?: boolean
  /** Other names on the proposal — empty in a blind round, where nobody may know. */
  readonly coSpeakers?: readonly { readonly name: string; readonly role: string }[]
}

/** One question on the reviewer's form, with whatever they have answered. */
export interface EvaluationRowCriterion {
  readonly id: string
  readonly label: string
  readonly kind: 'rating' | 'select' | 'text'
  readonly weight: number | null
  readonly scale: { readonly min: number; readonly max: number } | null
  readonly options: readonly string[] | null
  readonly value: number | string | null
}

/**
 * `comments` is a partial update: omit it to leave the stored justification
 * alone, send an empty string to clear it.
 */
export interface SubmitEvaluationInput {
  readonly submissionId: string
  /**
   * Which round this answers. A reviewer can hold one proposal in two open
   * rounds, each asking its own questions, so the proposal alone no longer
   * says which form was filled in.
   */
  readonly roundId?: string
  /** The single rating, on a round that has no questions of its own. */
  readonly rating?: number
  readonly comments?: string
  /** One entry per question, on a round that carries a scorecard. */
  readonly answers?: readonly { readonly criterionId: string; readonly value: unknown }[]
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
  return useServerMutation({ mutationFn: submitEvaluation, retry: false })
}

/** Which piece of reading the reviewer is stepping back from. */
export interface RecuseInput {
  readonly submissionId: string
  readonly roundId?: string
}

/** POST /api/public/evaluations/recuse — declare a conflict of interest. */
export async function recuseFromEvaluation(input: RecuseInput): Promise<void> {
  await requestJson<null>('/api/public/evaluations/recuse', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function useRecuseFromEvaluation() {
  return useServerMutation({ mutationFn: recuseFromEvaluation, retry: false })
}

/** What the evaluator had typed but not yet stored, per assigned submission. */
export interface EvaluationDraft {
  readonly rating: number | null
  readonly comments: string
}

const DRAFT_PREFIX = 'speakerops.evaluation-draft.'

function draftKey(submissionId: string): string {
  return `${DRAFT_PREFIX}${submissionId}`
}

/**
 * Session-scoped hold for in-progress work.
 *
 * A submitter session is short (30 minutes by default), and an evaluator
 * reading a full proposal will routinely outlive it. When the POST that would
 * have stored their rating comes back 401 the component is replaced by the
 * expired-session surface, so the typed rating and justification would
 * otherwise die with it. Stashing them here — and rehydrating on the next
 * mount — is what makes signing in again a resumption rather than a retype.
 *
 * `sessionStorage`, not `localStorage`: the draft is scoped to the browsing
 * session that produced it and never outlives the tab.
 */
export function stashEvaluationDraft(submissionId: string, draft: EvaluationDraft): void {
  try {
    window.sessionStorage.setItem(draftKey(submissionId), JSON.stringify(draft))
  } catch {
    // A storage-less or quota-exhausted browser must not break scoring; the
    // evaluator simply loses the resume, exactly as they do today.
  }
}

/** Reads back a stashed draft, tolerating absent or corrupted storage. */
export function readEvaluationDraft(submissionId: string): EvaluationDraft | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(submissionId))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { rating, comments } = parsed as { rating?: unknown; comments?: unknown }
    if (rating !== null && typeof rating !== 'number') return null
    if (typeof comments !== 'string') return null
    return { rating, comments }
  } catch {
    return null
  }
}

/** Drops a stashed draft once its rating has actually been stored. */
export function clearEvaluationDraft(submissionId: string): void {
  try {
    window.sessionStorage.removeItem(draftKey(submissionId))
  } catch {
    // Nothing to recover from: a draft that cannot be removed is still stale
    // only until the tab closes.
  }
}

/**
 * Recovery from an expired evaluator session: drop the rows fetched under the
 * dead session and send the evaluator to the start form to sign in again.
 * Mirrors `recoverPublicSession` for the CFP surfaces.
 */
export function recoverEvaluationSession(
  queryClient: QueryClient,
  router: AnyRouter | null | undefined,
): void {
  queryClient.removeQueries({ queryKey: publicEvaluationsQueryKeys.all, exact: true })
  if (router != null) {
    void router.navigate({ to: '/start' })
  }
}
