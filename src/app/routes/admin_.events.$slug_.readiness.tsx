import { createFileRoute, useParams } from '@tanstack/react-router'

import AppShell from '../features/nav/AppShell'
import ReadinessPage from '../features/admin/ReadinessPage'

import type {} from '../routeTree.gen'

function ReadinessRoutePage() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  return (
    <AppShell slug={slug ?? ''}>
      <ReadinessPage eventSlug={slug ?? ''} />
    </AppShell>
  )
}

const readinessRoute = createFileRoute('/admin_/events/$slug_/readiness')({
  component: ReadinessRoutePage,
})

// The generated route tree normally injects `path` via update(); the
// direct-import surface contract also exposes it on the module itself.
Object.assign(readinessRoute.options, { path: '/admin/events/$slug/readiness' })

// Narrow documented surface type: the test contract reads `options.path`
// directly off the module; the library Route options type omits it.
export const Route = readinessRoute as typeof readinessRoute & {
  readonly options: { readonly path: string }
}
