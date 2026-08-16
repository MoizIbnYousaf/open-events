import { useCallback } from 'react'
import type { ComponentType } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import PortalPageComponent from '../../features/public/PortalPage'

import type {} from '../../routeTree.gen'

/** Route component: sends visitors without a session to the /start step. */
function PortalRouteComponent() {
  const navigate = useNavigate()
  const onUnauthenticated = useCallback(() => {
    void navigate({ to: '/start', search: { access: 'portal' } })
  }, [navigate])
  return <PortalPageComponent onUnauthenticated={onUnauthenticated} />
}

const portalRoute = createFileRoute('/_public/portal')({
  component: PortalRouteComponent,
})

// The generated route tree normally injects `path` via update(); the
// direct-import surface contract also exposes it on the module itself.
Object.assign(portalRoute.options, { path: '/portal' })

// Narrow documented surface type: the test contract reads `options.path`
// directly off the module; the library Route options type omits it.
export const Route = portalRoute as typeof portalRoute & {
  readonly options: { readonly path: string }
}

/** Named page export for consumers that import the route module directly. */
export const PortalPage = Route.options.component as ComponentType
