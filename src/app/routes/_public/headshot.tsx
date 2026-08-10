import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import HeadshotUploaderComponent from '../../features/public/HeadshotUploader'

import type {} from '../../routeTree.gen'

const headshotRoute = createFileRoute('/_public/headshot')({
  component: HeadshotUploaderComponent,
})

// The generated route tree normally injects `path` via update(); the
// direct-import surface contract also exposes it on the module itself.
Object.assign(headshotRoute.options, { path: '/headshot' })

// Narrow documented surface type: the test contract reads `options.path`
// directly off the module; the library Route options type omits it.
export const Route = headshotRoute as typeof headshotRoute & {
  readonly options: { readonly path: string }
}

/** Named page export for consumers that import the route module directly. */
export const HeadshotPage = Route.options.component as ComponentType
