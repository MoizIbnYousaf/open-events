import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getAcceptancePreview,
  listSubmissionMessages,
  sendAcceptance,
} from '../api/admin-communications'
import type { SubmissionId } from '../../domain'

export const adminCommunicationQueryKeys = {
  acceptancePreview: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'acceptance-preview'] as const,
  messages: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'messages'] as const,
}

export function useAcceptancePreview(submissionId: SubmissionId | undefined) {
  return useQuery({
    queryKey: adminCommunicationQueryKeys.acceptancePreview(submissionId ?? ''),
    queryFn: () => getAcceptancePreview(submissionId as SubmissionId),
    enabled: submissionId !== undefined,
  })
}

export function useSubmissionMessages(submissionId: SubmissionId | undefined) {
  return useQuery({
    queryKey: adminCommunicationQueryKeys.messages(submissionId ?? ''),
    queryFn: () => listSubmissionMessages(submissionId as SubmissionId),
    enabled: submissionId !== undefined,
  })
}

/** Sending is idempotent server-side; both reads refetch so the UI stays real. */
export function useSendAcceptance(submissionId: SubmissionId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => sendAcceptance(submissionId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminCommunicationQueryKeys.messages(submissionId),
        }),
        queryClient.invalidateQueries({
          queryKey: adminCommunicationQueryKeys.acceptancePreview(submissionId),
        }),
      ])
    },
  })
}
