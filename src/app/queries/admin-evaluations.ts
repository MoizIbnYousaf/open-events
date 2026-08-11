import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import {
  assignEvaluator,
  closeEvaluationRound,
  defineEvaluationCriteria,
  getEvaluationSummary,
  listEvaluationAssignments,
  listEvaluationCriteria,
  listEvaluationRounds,
  openEvaluationRound,
  type CriterionInput,
} from '../api/admin-evaluations'
import type { EventSlug, EvaluationRoundId, SubmissionId } from '../../domain'

export const adminEvaluationQueryKeys = {
  criteria: (slug: EventSlug) => ['admin', 'events', slug, 'criteria'] as const,
  rounds: (slug: EventSlug) => ['admin', 'events', slug, 'rounds'] as const,
  assignments: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'assignments'] as const,
  summary: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'evaluation-summary'] as const,
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
    mutationFn: (evaluatorEmail: string) => assignEvaluator(slug, submissionId, evaluatorEmail),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminEvaluationQueryKeys.assignments(submissionId),
        }),
        queryClient.invalidateQueries({
          queryKey: adminEvaluationQueryKeys.summary(submissionId),
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
