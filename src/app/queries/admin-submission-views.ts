import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'
import type { SubmissionViewState } from '../../application/dtos/submission-view.dto'
import type { EventSlug } from '../../domain'
import {
  createSubmissionView,
  deleteSubmissionView,
  listSubmissionViews,
} from '../api/admin-submission-views'

export const submissionViewQueryKeys = {
  list: (slug: EventSlug) => ['admin', 'events', slug, 'submission-views'] as const,
}

export function useSubmissionViews(slug: EventSlug) {
  return useQuery({
    queryKey: submissionViewQueryKeys.list(slug),
    queryFn: () => listSubmissionViews(slug),
  })
}

export function useCreateSubmissionView(slug: EventSlug) {
  const client = useQueryClient()
  return useServerMutation({
    mutationFn: (input: { readonly name: string; readonly state: SubmissionViewState }) =>
      createSubmissionView(slug, input),
    onSuccess: () => client.invalidateQueries({ queryKey: submissionViewQueryKeys.list(slug) }),
  })
}

export function useDeleteSubmissionView(slug: EventSlug) {
  const client = useQueryClient()
  return useServerMutation({
    mutationFn: (id: string) => deleteSubmissionView(slug, id),
    onSuccess: () => client.invalidateQueries({ queryKey: submissionViewQueryKeys.list(slug) }),
  })
}
