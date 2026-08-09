// Adapted from cloudflare-os (Apache-2.0) @ 1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592 — see THIRD_PARTY_NOTICES.md
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
