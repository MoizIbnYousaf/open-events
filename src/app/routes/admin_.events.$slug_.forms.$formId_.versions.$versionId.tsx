import { createFileRoute } from '@tanstack/react-router'

import VersionDetail from '../features/builder/VersionDetail'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin_/events/$slug_/forms/$formId_/versions/$versionId')({
  component: VersionDetail,
})
