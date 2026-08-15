import type {
  EvaluationAssignmentDto,
  EvaluationCriterionDto,
  EvaluationResultRowDto,
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

/**
 * POST /api/admin/submissions/:id/assignments — idempotent.
 *
 * Into the named round, or the live one when no round is named. The server has
 * accepted a round all along; not sending one is what made every assignment
 * land in whichever round happened to be open.
 */
export type ReviewerInvite = {
  readonly invitePath?: string | null
  readonly inviteSent?: boolean
}

export function assignEvaluator(
  slug: EventSlug,
  submissionId: SubmissionId,
  evaluatorEmail: string,
  roundId?: string,
): Promise<EvaluationAssignmentDto & ReviewerInvite> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/assignments`,
    {
      method: 'POST',
      body: JSON.stringify({ evaluatorEmail, ...(roundId === undefined ? {} : { roundId }) }),
    },
  )
}

/** One seat on the committee, with the workload the organizer judges it by. */
export interface CommitteeRosterEntry {
  readonly contactId: string
  readonly email: string
  readonly name: string
  readonly addedAt: string
  readonly assignedCount: number
  readonly completedCount: number
}

/** GET the event's committee roster. */
export function listCommittee(slug: EventSlug): Promise<readonly CommitteeRosterEntry[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/evaluations/committee`)
}

/**
 * POST a reviewer onto the committee by email, creating the contact when nobody
 * has ever used that address. Idempotent, and scoped to this event alone.
 */
export function addCommitteeMember(
  slug: EventSlug,
  email: string,
): Promise<CommitteeRosterEntry & { readonly created: boolean } & ReviewerInvite> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/evaluations/committee`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/** DELETE one seat. The person and their recorded scores are untouched. */
export function removeCommitteeMember(
  slug: EventSlug,
  contactId: string,
): Promise<{ readonly removed: boolean }> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/evaluations/committee/${encodeURIComponent(contactId)}`,
    { method: 'DELETE' },
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

/** One question on a round's scorecard, as the organizer surface reads it. */
export interface RoundCriterion {
  readonly id: string
  readonly label: string
  readonly kind: 'rating' | 'select' | 'text'
  readonly weight: number | null
  readonly position: number
  readonly scale: { readonly min: number; readonly max: number } | null
  readonly options: readonly string[] | null
}

/** A proposed question; the id is reused when the organizer is editing one. */
export interface RoundCriterionInput {
  readonly id?: string
  readonly label: string
  readonly kind: 'rating' | 'select' | 'text'
  readonly weight: number | null
  readonly scale?: { readonly min: number; readonly max: number } | null
  readonly options?: readonly string[] | null
}

export interface RoundConfigInput {
  readonly name: string
  readonly opensAt: string | null
  readonly closesAt: string | null
  readonly anonymize: boolean
}

function roundPath(slug: EventSlug, roundId: string): string {
  return `/api/admin/events/${encodeURIComponent(slug)}/rounds/${encodeURIComponent(roundId)}`
}

/** PUT the round's name, window and blindness. */
export function configureRound(
  slug: EventSlug,
  roundId: string,
  config: RoundConfigInput,
): Promise<unknown> {
  return requestJson(roundPath(slug, roundId), {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

export function getRoundScorecard(
  slug: EventSlug,
  roundId: string,
): Promise<readonly RoundCriterion[]> {
  return requestJson(`${roundPath(slug, roundId)}/scorecard`)
}

/** Replaces the round's questions wholesale, as the screen edits them. */
export function putRoundScorecard(
  slug: EventSlug,
  roundId: string,
  criteria: readonly RoundCriterionInput[],
): Promise<readonly RoundCriterion[]> {
  return requestJson(`${roundPath(slug, roundId)}/scorecard`, {
    method: 'PUT',
    body: JSON.stringify({ criteria }),
  })
}

export function getRoundPool(
  slug: EventSlug,
  roundId: string,
): Promise<readonly { readonly contactId: string }[]> {
  return requestJson(`${roundPath(slug, roundId)}/pool`)
}

export function putRoundPool(
  slug: EventSlug,
  roundId: string,
  contactIds: readonly string[],
): Promise<readonly { readonly contactId: string }[]> {
  return requestJson(`${roundPath(slug, roundId)}/pool`, {
    method: 'PUT',
    body: JSON.stringify({ contactIds }),
  })
}

/** What a nudge did: who was mailed, and who needed nothing. */
export interface RemindReviewersResult {
  readonly reminded: number
  readonly upToDate: number
}

/** POST .../evaluations/committee/remind — nudge whoever is behind. */
export function remindReviewers(slug: EventSlug): Promise<RemindReviewersResult> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/evaluations/committee/remind`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

/** What a share-out did, in the terms the organizer asked in. */
export interface DistributeRoundResult {
  readonly assigned: number
  readonly reviewers: number
  readonly considered: number
  readonly unassigned: number
}

export interface DistributeRoundBody {
  readonly readersPerSubmission: number
  readonly perReviewerCap?: number | null
  readonly track?: string | null
}

/** POST .../rounds/:id/distribute — share this round's reading out at once. */
export function distributeRound(
  slug: EventSlug,
  roundId: string,
  body: DistributeRoundBody,
): Promise<DistributeRoundResult> {
  return requestJson(`${roundPath(slug, roundId)}/distribute`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** GET /api/admin/events/:slug/results — every proposal with what it scored. */
export function listEvaluationResults(slug: EventSlug): Promise<readonly EvaluationResultRowDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/results`)
}
