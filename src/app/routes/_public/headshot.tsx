import type { ComponentType } from 'react'
import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import HeadshotUploader from '../../features/public/HeadshotUploader'

import type {} from '../../routeTree.gen'

/**
 * Standalone headshot page. The uploader is a composable section (it is also
 * rendered inside /portal), so the page owns the single h1 here.
 */
function HeadshotRouteComponent() {
  useEffect(() => {
    document.title = 'Your headshot — SpeakerOps'
  }, [])

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Your headshot</h1>
      <HeadshotUploader />
    </div>
  )
}

const headshotRoute = createFileRoute('/_public/headshot')({
  component: HeadshotRouteComponent,
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
