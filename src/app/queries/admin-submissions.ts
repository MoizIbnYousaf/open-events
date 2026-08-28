import { useQuery } from '@tanstack/react-query'

import { getSubmissionDetail, listSubmissionDesk, listSubmissions } from '../api/submissions'
import type { EventSlug, SubmissionId } from '../../domain'
import type { SubmissionDeskQuery } from '../../application/dtos/submission-desk.dto'

export const adminSubmissionQueryKeys = {
  list: (slug: EventSlug) => ['admin', 'events', slug, 'submissions'] as const,
  detail: (slug: EventSlug, submissionId: SubmissionId) =>
    ['admin', 'events', slug, 'submissions', submissionId] as const,
  desk: (slug: EventSlug, query: SubmissionDeskQuery) =>
    ['admin', 'events', slug, 'submission-desk', query] as const,
}

export function useSubmissionDesk(slug: EventSlug | undefined, query: SubmissionDeskQuery) {
  return useQuery({
    queryKey: adminSubmissionQueryKeys.desk(slug ?? '', query),
    queryFn: () => listSubmissionDesk(slug as EventSlug, query),
    enabled: slug !== undefined,
  })
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
