import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'
import { queriesInvalidatedOnVerdict } from './verdict-invalidation'

import {
  acceptSubmission,
  getAcceptancePreview,
  getReminderPreview,
  listSubmissionMessages,
  decideSubmission,
  sendAcceptance,
  sendReminder,
} from '../api/admin-communications'
import type { EventSlug, SubmissionId } from '../../domain'

/** A verdict that has actually been reached, as opposed to 'pending'. */
export type SubmissionDecision = 'accepted' | 'rejected'

/** What a surface is told: the recorded verdict, or that nobody has ruled yet. */
export type SubmissionOutcome = 'pending' | SubmissionDecision

/**
 * The outcome an organizer surface should render, from an acceptance preview
 * that may not have loaded yet.
 *
 * The `accepted` boolean beside it is NOT consulted. It reports only whether
 * the acceptance RECORD exists, and that record deliberately survives a
 * rejection — the onboarding checklist hangs a foreign key off it — so on a
 * rejected proposal `accepted` is still true and is precisely the field that
 * must not be believed. The server states the verdict; this reads it.
 *
 * An absent preview is 'pending' rather than a verdict, so a page that has not
 * finished loading never announces a decision nobody made.
 */
export function readDecision(
  preview: { readonly decision: SubmissionOutcome } | undefined,
): SubmissionOutcome {
  return preview?.decision ?? 'pending'
}

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
      await Promise.all(
        queriesInvalidatedOnVerdict(slug, submissionId).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
    },
  })
}

/**
 * The other decision, invalidating exactly what accepting does.
 *
 * A rejection can follow an acceptance — an organizer is allowed to change
 * their mind — and that reversal moves the send gate too, so the preview has to
 * be re-read rather than patched locally.
 */
export function useRejectSubmission(slug: EventSlug, submissionId: SubmissionId) {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: () => decideSubmission(slug, submissionId, 'rejected'),
    onSuccess: async () => {
      await Promise.all(
        queriesInvalidatedOnVerdict(slug, submissionId).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
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
