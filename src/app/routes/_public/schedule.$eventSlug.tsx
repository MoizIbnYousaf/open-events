import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import PublicSchedulePageComponent from '../../features/public/PublicSchedulePage'

import type {} from '../../routeTree.gen'

const publicScheduleRoute = createFileRoute('/_public/schedule/$eventSlug')({
  component: PublicSchedulePageComponent,
})

// The generated route tree normally injects `path` via update(); the
// direct-import surface contract also exposes it on the module itself.
Object.assign(publicScheduleRoute.options, { path: '/schedule/$eventSlug' })

// Narrow documented surface type: the test contract reads `options.path`
// directly off the module; the library Route options type omits it.
export const Route = publicScheduleRoute as typeof publicScheduleRoute & {
  readonly options: { readonly path: string }
}

/** Named page export for consumers that import the route module directly. */
export const PublicSchedulePage = Route.options.component as ComponentType<{
  readonly eventSlug?: string
}>
