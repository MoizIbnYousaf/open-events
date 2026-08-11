// Adapted from cloudflare-os (Apache-2.0) @ 1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592 — see THIRD_PARTY_NOTICES.md
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { RouteErrorState } from './CrashStates'
import { NotFoundState } from './NotFoundState'
import { reportRouteCrash } from './error-reporting'

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // TanStack only installs its CatchBoundary when an error component is
    // declared; without these two options every match renders inside a
    // SafeFragment and a render throw takes the whole app down to a blank page.
    defaultErrorComponent: RouteErrorState,
    defaultOnCatch: reportRouteCrash,
    // Without this an unmatched URL renders TanStack's built-in bare "Not
    // Found" text: no chrome, no way back, nothing announced. A 404 is not an
    // error, so it gets its own component rather than the crash surface.
    defaultNotFoundComponent: NotFoundState,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
