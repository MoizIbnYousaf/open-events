import { createFileRoute } from '@tanstack/react-router'

import VersionDetail from '../features/builder/VersionDetail'

import type {} from '../routeTree.gen'

const versionDetailRoute = createFileRoute(
  '/admin_/events/$slug_/forms/$formId_/versions/$versionId',
)({
  component: VersionDetail,
})

Object.assign(versionDetailRoute.options, {
  path: '/admin/events/$slug/forms/$formId/versions/$versionId',
})

export const Route = versionDetailRoute as typeof versionDetailRoute & {
  readonly options: { readonly path: string }
}
