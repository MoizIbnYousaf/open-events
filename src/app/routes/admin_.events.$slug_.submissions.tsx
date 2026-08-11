import { createFileRoute } from '@tanstack/react-router'

import SubmissionList from '../features/admin/SubmissionList'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin_/events/$slug_/submissions')({
  component: SubmissionList,
})
