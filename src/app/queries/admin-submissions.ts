import { useQuery } from '@tanstack/react-query'

import { getSubmissionDetail, listSubmissions } from '../api/submissions'
import type { EventSlug, SubmissionId } from '../../domain'

export const adminSubmissionQueryKeys = {
  list: (slug: EventSlug) => ['admin', 'events', slug, 'submissions'] as const,
  detail: (slug: EventSlug, submissionId: SubmissionId) =>
    ['admin', 'events', slug, 'submissions', submissionId] as const,
}

export function useSubmissionList(slug: EventSlug | undefined) {
  return useQuery({
    queryKey: adminSubmissionQueryKeys.list(slug ?? ''),
    queryFn: () => listSubmissions(slug as EventSlug),
    enabled: slug !== undefined,
  })
}

export function useSubmissionDetail(
  slug: EventSlug | undefined,
  submissionId: SubmissionId | undefined,
) {
  return useQuery({
    queryKey: adminSubmissionQueryKeys.detail(slug ?? '', submissionId ?? ''),
    queryFn: () => getSubmissionDetail(slug as EventSlug, submissionId as SubmissionId),
    enabled: slug !== undefined && submissionId !== undefined,
  })
}
