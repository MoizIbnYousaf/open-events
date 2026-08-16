import { createFileRoute, useParams } from '@tanstack/react-router'

import EmbedsPage from '../features/admin/EmbedsPage'

import type {} from '../routeTree.gen'

function EmbedsRoutePage() {
  const { slug } = useParams({ from: '/admin_/events/$slug_/embeds' })
  return <EmbedsPage eventSlug={slug} />
}

const embedsRoute = createFileRoute('/admin_/events/$slug_/embeds')({
  component: EmbedsRoutePage,
})

Object.assign(embedsRoute.options, { path: '/admin/events/$slug/embeds' })

export const Route = embedsRoute as typeof embedsRoute & {
  readonly options: { readonly path: string }
}
