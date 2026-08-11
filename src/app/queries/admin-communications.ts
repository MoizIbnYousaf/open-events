import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import {
  acceptSubmission,
  getAcceptancePreview,
  getReminderPreview,
  listSubmissionMessages,
  sendAcceptance,
  sendReminder,
} from '../api/admin-communications'
import type { EventSlug, SubmissionId } from '../../domain'

export const adminCommunicationQueryKeys = {
  acceptancePreview: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'acceptance-preview'] as const,
  messages: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'messages'] as const,
  reminderPreview: (submissionId: SubmissionId) =>
    ['admin', 'submissions', submissionId, 'reminder-preview'] as const,
}

export function useAcceptancePreview(
  slug: EventSlug | undefined,
  submissionId: SubmissionId | undefined,
) {
  return useQuery({
    queryKey: adminCommunicationQueryKeys.acceptancePreview(submissionId ?? ''),
    queryFn: () => getAcceptancePreview(slug as EventSlug, submissionId as SubmissionId),
    enabled: slug !== undefined && submissionId !== undefined,
  })
}

export function useSubmissionMessages(
  slug: EventSlug | undefined,
  submissionId: SubmissionId | undefined,
) {
  return useQuery({
    queryKey: adminCommunicationQueryKeys.messages(submissionId ?? ''),
    queryFn: () => listSubmissionMessages(slug as EventSlug, submissionId as SubmissionId),
    enabled: slug !== undefined && submissionId !== undefined,
  })
}

/**
 * Accepting is idempotent server-side. The acceptance state is refetched
 * afterwards rather than assumed, so the panel's send gate always reflects the
 * persisted acceptance record.
 */
export function useAcceptSubmission(slug: EventSlug, submissionId: SubmissionId) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: () => acceptSubmission(slug, submissionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminCommunicationQueryKeys.acceptancePreview(submissionId),
      })
    },
  })
}

/** Sending is idempotent server-side; both reads refetch so the UI stays real. */
export function useSendAcceptance(slug: EventSlug, submissionId: SubmissionId) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: () => sendAcceptance(slug, submissionId),
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

export function useReminderPreview(
  slug: EventSlug | undefined,
  submissionId: SubmissionId | undefined,
) {
  return useQuery({
    queryKey: adminCommunicationQueryKeys.reminderPreview(submissionId ?? ''),
    queryFn: () => getReminderPreview(slug as EventSlug, submissionId as SubmissionId),
    enabled: slug !== undefined && submissionId !== undefined,
  })
}

/** Reminder send mirrors acceptance: idempotent per recipient, reads refetch. */
export function useSendReminder(slug: EventSlug, submissionId: SubmissionId) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: () => sendReminder(slug, submissionId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminCommunicationQueryKeys.messages(submissionId),
        }),
        queryClient.invalidateQueries({
          queryKey: adminCommunicationQueryKeys.reminderPreview(submissionId),
        }),
      ])
    },
  })
}
