import { createFileRoute } from '@tanstack/react-router'

import SubmissionList from '../features/admin/SubmissionList'
import { submissionSearchValidator } from './-submission-search-validator'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin_/events/$slug_/submissions')({
  validateSearch: submissionSearchValidator,
  component: SubmissionList,
})
