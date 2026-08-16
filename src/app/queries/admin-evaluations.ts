import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import {
  addCommitteeMember,
  assignEvaluator,
  closeEvaluationRound,
  configureRound,
  defineEvaluationCriteria,
  getEvaluationSummary,
  getRoundPool,
  getRoundScorecard,
  listCommittee,
  listEvaluationAssignments,
  listEvaluationCriteria,
  listEvaluationResults,
  listEvaluationRounds,
  openEvaluationRound,
  putRoundPool,
  putRoundScorecard,
  removeCommitteeMember,
  type CriterionInput,
  type RoundConfigInput,
  type RoundCriterionInput,
  distributeRound,
  remindReviewers,
} from '../api/admin-evaluations'
import type { DistributeRoundBody } from '../api/admin-evaluations'
import type { EventSlug, EvaluationRoundId, SubmissionId } from '../../domain'

export const adminEvaluationQueryKeys = {
  criteria: (slug: EventSlug) => ['admin', 'events', slug, 'criteria'] as const,
  rounds: (slug: EventSlug) => ['admin', 'events', slug, 'rounds'] as const,
  committee: (slug: EventSlug) => ['admin', 'events', slug, 'committee'] as const,
  assignments: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'assignments'] as const,
  summary: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'evaluation-summary'] as const,
}

export const roundConfigQueryKeys = {
  scorecard: (slug: EventSlug, roundId: string) =>
    ['admin', 'events', slug, 'rounds', roundId, 'scorecard'] as const,
  pool: (slug: EventSlug, roundId: string) =>
    ['admin', 'events', slug, 'rounds', roundId, 'pool'] as const,
}

export function useRoundScorecard(slug: EventSlug, roundId: string) {
  return useQuery({
    queryKey: roundConfigQueryKeys.scorecard(slug, roundId),
    queryFn: () => getRoundScorecard(slug, roundId),
  })
}

export function useRoundPool(slug: EventSlug, roundId: string) {
  return useQuery({
    queryKey: roundConfigQueryKeys.pool(slug, roundId),
    queryFn: () => getRoundPool(slug, roundId),
  })
}

/** Configuring a round changes what the rounds list shows, so it refetches. */
export function useConfigureRound(slug: EventSlug, roundId: string) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (config: RoundConfigInput) => configureRound(slug, roundId, config),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminEvaluationQueryKeys.rounds(slug) })
    },
  })
}

/** Nudging changes nothing an organizer is looking at, so nothing is refetched. */
export function useRemindReviewers(slug: EventSlug) {
  return useServerMutation({ mutationFn: () => remindReviewers(slug) })
}

/**
 * Sharing the round out changes assignments across many proposals at once, so
 * every list that counts them is refetched rather than the one the organizer
 * happens to be looking at.
 */
export function useDistributeRound(slug: EventSlug, roundId: string) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (body: DistributeRoundBody) => distributeRound(slug, roundId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminEvaluationQueryKeys.committee(slug) })
      await queryClient.invalidateQueries({ queryKey: roundConfigQueryKeys.pool(slug, roundId) })
    },
  })
}

export function usePutRoundScorecard(slug: EventSlug, roundId: string) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (criteria: readonly RoundCriterionInput[]) =>
      putRoundScorecard(slug, roundId, criteria),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: roundConfigQueryKeys.scorecard(slug, roundId),
      })
    },
  })
}

export function usePutRoundPool(slug: EventSlug, roundId: string) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (contactIds: readonly string[]) => putRoundPool(slug, roundId, contactIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: roundConfigQueryKeys.pool(slug, roundId) })
    },
  })
}

export function useCommittee(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminEvaluationQueryKeys.committee(slug ?? ''),
    queryFn: () => listCommittee(slug as EventSlug),
    enabled: slug !== undefined,
  })
}

/**
 * Seats a reviewer, then refetches the roster rather than appending locally:
 * the server decides whether this was a new seat or an existing one, and what
 * name the contact actually carries (an invite never renames a person).
 */
export function useAddCommitteeMember(slug: EventSlug) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (email: string) => addCommitteeMember(slug, email),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminEvaluationQueryKeys.committee(slug) })
    },
  })
}

export function useRemoveCommitteeMember(slug: EventSlug) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (contactId: string) => removeCommitteeMember(slug, contactId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminEvaluationQueryKeys.committee(slug) })
    },
  })
}

export function useEvaluationCriteria(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminEvaluationQueryKeys.criteria(slug ?? ''),
    queryFn: () => listEvaluationCriteria(slug as EventSlug),
    enabled: slug !== undefined,
  })
}

/**
 * Defining criteria replaces the event's whole set, so the caller sends every
 * criterion it wants to survive. The stored list is refetched rather than
 * assumed, because the server keys criteria by name and returns what persisted.
 */
export function useDefineEvaluationCriteria(slug: EventSlug) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (criteria: readonly CriterionInput[]) => defineEvaluationCriteria(slug, criteria),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminEvaluationQueryKeys.criteria(slug) })
    },
  })
}

/**
 * Opening or closing a round from the event-level surface, where no single
 * submission is in view. Only the round list can go stale here.
 */
export function useRunEventRounds(slug: EventSlug) {
  const queryClient = useQueryClient()
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: adminEvaluationQueryKeys.rounds(slug) })
  }
  const open = useServerMutation({
    mutationFn: (input: { readonly number: number; readonly name: string }) =>
      openEvaluationRound(slug, input),
    onSuccess: refresh,
  })
  const close = useServerMutation({
    mutationFn: (roundId: EvaluationRoundId) => closeEvaluationRound(slug, roundId),
    onSuccess: refresh,
  })
  return { open, close }
}

export function useEvaluationRounds(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminEvaluationQueryKeys.rounds(slug ?? ''),
    queryFn: () => listEvaluationRounds(slug as EventSlug),
    enabled: slug !== undefined,
  })
}

export function useEvaluationAssignments(
  slug: EventSlug | undefined,
  submissionId: SubmissionId | undefined,
) {
  return useQuery({
    queryKey: adminEvaluationQueryKeys.assignments(submissionId ?? ''),
    queryFn: () => listEvaluationAssignments(slug as EventSlug, submissionId as SubmissionId),
    enabled: slug !== undefined && submissionId !== undefined,
  })
}

export function useEvaluationSummary(
  slug: EventSlug | undefined,
  submissionId: SubmissionId | undefined,
) {
  return useQuery({
    queryKey: adminEvaluationQueryKeys.summary(submissionId ?? ''),
    queryFn: () => getEvaluationSummary(slug as EventSlug, submissionId as SubmissionId),
    enabled: slug !== undefined && submissionId !== undefined,
  })
}

/** Staffing the committee changes both the roster and the round's result. */
export function useAssignEvaluator(slug: EventSlug, submissionId: SubmissionId) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (input: { readonly evaluatorEmail: string; readonly roundId?: string }) =>
      assignEvaluator(slug, submissionId, input.evaluatorEmail, input.roundId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminEvaluationQueryKeys.assignments(submissionId),
        }),
        queryClient.invalidateQueries({
          queryKey: adminEvaluationQueryKeys.summary(submissionId),
        }),
        // Assigning SEATS the evaluator (`assign()` adds them to the committee)
        // and changes their workload, and both are what the roster shows. Left
        // out, an organizer who assigns from a submission then opens Review
        // committee sees a committee missing the person they just added, and
        // counts that are quietly wrong for everyone else.
        queryClient.invalidateQueries({
          queryKey: adminEvaluationQueryKeys.committee(slug),
        }),
      ])
    },
  })
}

/**
 * Opening or closing a round moves which round is live, so the roster and the
 * summary are refetched beside the round list rather than left to go stale.
 */
export function useRunEvaluationRound(slug: EventSlug, submissionId: SubmissionId) {
  const queryClient = useQueryClient()
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminEvaluationQueryKeys.rounds(slug) }),
      queryClient.invalidateQueries({
        queryKey: adminEvaluationQueryKeys.assignments(submissionId),
      }),
      queryClient.invalidateQueries({ queryKey: adminEvaluationQueryKeys.summary(submissionId) }),
    ])
  }
  const open = useServerMutation({
    mutationFn: (input: { readonly number: number; readonly name: string }) =>
      openEvaluationRound(slug, input),
    onSuccess: refresh,
  })
  const close = useServerMutation({
    mutationFn: (roundId: EvaluationRoundId) => closeEvaluationRound(slug, roundId),
    onSuccess: refresh,
  })
  return { open, close }
}

export function useEvaluationResults(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: [...adminEvaluationQueryKeys.rounds(slug ?? ''), 'results'] as const,
    queryFn: () => listEvaluationResults(slug as EventSlug),
    enabled: slug !== undefined,
  })
}
