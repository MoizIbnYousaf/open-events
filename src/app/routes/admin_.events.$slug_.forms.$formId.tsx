import { createFileRoute } from '@tanstack/react-router'

import BuilderEditor from '../features/builder/BuilderEditor'

import type {} from '../routeTree.gen'

const builderFormRoute = createFileRoute('/admin_/events/$slug_/forms/$formId')({
  component: BuilderEditor,
})

Object.assign(builderFormRoute.options, { path: '/admin/events/$slug/forms/$formId' })

export const Route = builderFormRoute as typeof builderFormRoute & {
  readonly options: { readonly path: string }
}
