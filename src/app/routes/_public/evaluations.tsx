import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import EvaluationsPageComponent from '../../features/public/EvaluationsPage'

import type {} from '../../routeTree.gen'

const evaluationsRoute = createFileRoute('/_public/evaluations')({
  component: EvaluationsPageComponent,
})

// The generated route tree normally injects `path` via update(); the
// direct-import surface contract also exposes it on the module itself.
Object.assign(evaluationsRoute.options, { path: '/evaluations' })

// Narrow documented surface type: the test contract reads `options.path`
// directly off the module; the library Route options type omits it.
export const Route = evaluationsRoute as typeof evaluationsRoute & {
  readonly options: { readonly path: string }
}

/** Named page export for route-level consumers; identical to Route.options.component. */
export const EvaluationsPage = Route.options.component as ComponentType
