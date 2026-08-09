import { createFileRoute } from '@tanstack/react-router'

import SubmissionDetail from '../features/admin/SubmissionDetail'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin_/events/$slug_/submissions_/$submissionId')({
  component: SubmissionDetail,
})
