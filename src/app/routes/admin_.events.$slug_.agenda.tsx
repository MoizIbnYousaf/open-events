import { createFileRoute, useParams } from '@tanstack/react-router'

import AgendaAdminPage from '../features/admin/AgendaAdminPage'

import type {} from '../routeTree.gen'

// The feature mounts `AppShell` itself, exactly as the other organizer features
// do (C1 F9): the route file resolves the slug and nothing else, so a new
// organizer route cannot land shell-less by forgetting to wrap it here.
function AgendaAdminRoutePage() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  return <AgendaAdminPage eventSlug={slug ?? ''} />
}

const agendaAdminRoute = createFileRoute('/admin_/events/$slug_/agenda')({
  component: AgendaAdminRoutePage,
})

// The generated route tree normally injects `path` via update(); the
// direct-import surface contract also exposes it on the module itself.
Object.assign(agendaAdminRoute.options, { path: '/admin/events/$slug/agenda' })

// Narrow documented surface type: the test contract reads `options.path`
// directly off the module; the library Route options type omits it.
export const Route = agendaAdminRoute as typeof agendaAdminRoute & {
  readonly options: { readonly path: string }
}
