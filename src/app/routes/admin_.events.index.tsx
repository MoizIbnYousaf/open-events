import { createFileRoute } from '@tanstack/react-router'

import EventsIndexPage from '../features/admin/EventsIndexPage'

import type {} from '../routeTree.gen'

const eventsIndexRoute = createFileRoute('/admin_/events/')({
  component: EventsIndexPage,
})

Object.assign(eventsIndexRoute.options, { path: '/admin/events/' })

export const Route = eventsIndexRoute as typeof eventsIndexRoute & {
  readonly options: { readonly path: string }
}
