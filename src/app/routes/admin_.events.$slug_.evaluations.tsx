import { createFileRoute } from '@tanstack/react-router'

import EvaluationCommitteePage from '../features/admin/EvaluationCommitteePage'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin_/events/$slug_/evaluations')({
  component: EvaluationCommitteePage,
})
