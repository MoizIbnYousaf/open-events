import { Outlet, createFileRoute } from '@tanstack/react-router'

import type {} from '../routeTree.gen'

function AdminEventsLayout() {
  return <Outlet />
}

const eventsLayoutRoute = createFileRoute('/admin_/events')({
  component: AdminEventsLayout,
})

Object.assign(eventsLayoutRoute.options, { path: '/admin/events' })

export const Route = eventsLayoutRoute as typeof eventsLayoutRoute & {
  readonly options: { readonly path: string }
}
