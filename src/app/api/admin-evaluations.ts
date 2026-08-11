import type {
  EvaluationAssignmentDto,
  EvaluationCriterionDto,
  EvaluationRoundDto,
  EvaluationSummaryDto,
} from '../../application'
import type { EventSlug, EvaluationRoundId, SubmissionId } from '../../domain'

import { requestJson } from './admin-events'

/** One weighted criterion as the organizer states it, before it has an id. */
export interface CriterionInput {
  readonly name: string
  readonly weight: number
  readonly position: number
}

/** GET /api/admin/events/:slug/criteria — the event's weighted criteria. */
export function listEvaluationCriteria(
  slug: EventSlug,
): Promise<readonly EvaluationCriterionDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/criteria`)
}

/**
 * POST /api/admin/events/:slug/criteria — defines the whole set, keyed by
 * name. The route replaces what it is given, so a caller adding one criterion
 * resends the criteria already defined alongside it.
 */
export function defineEvaluationCriteria(
  slug: EventSlug,
  criteria: readonly CriterionInput[],
): Promise<readonly EvaluationCriterionDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/criteria`, {
    method: 'POST',
    body: JSON.stringify({ criteria }),
  })
}

/** GET /api/admin/events/:slug/rounds — the event's review rounds, by number. */
export function listEvaluationRounds(slug: EventSlug): Promise<readonly EvaluationRoundDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/rounds`)
}

/** POST /api/admin/events/:slug/rounds — opens a numbered round (idempotent). */
export function openEvaluationRound(
  slug: EventSlug,
  input: { readonly number: number; readonly name: string },
): Promise<EvaluationRoundDto> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/rounds`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** POST /api/admin/events/:slug/rounds/:id/close — one-way close, idempotent. */
export function closeEvaluationRound(
  slug: EventSlug,
  roundId: EvaluationRoundId,
): Promise<EvaluationRoundDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/rounds/${encodeURIComponent(roundId)}/close`,
    { method: 'POST' },
  )
}

/** GET /api/admin/submissions/:id/assignments — the committee roster. */
export function listEvaluationAssignments(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<readonly EvaluationAssignmentDto[]> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/assignments`,
  )
}

/** POST /api/admin/submissions/:id/assignments — idempotent, into the live round. */
export function assignEvaluator(
  slug: EventSlug,
  submissionId: SubmissionId,
  evaluatorEmail: string,
): Promise<EvaluationAssignmentDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/assignments`,
    {
      method: 'POST',
      body: JSON.stringify({ evaluatorEmail }),
    },
  )
}

/** GET /api/admin/submissions/:id/evaluation-summary — every round's result. */
export function getEvaluationSummary(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<EvaluationSummaryDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/evaluation-summary`,
  )
}
