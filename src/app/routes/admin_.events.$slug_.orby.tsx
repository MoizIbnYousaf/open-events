import { createFileRoute, useParams } from '@tanstack/react-router'

import SupportDesk from '../features/admin/SupportDesk'

import type {} from '../routeTree.gen'

function OrbyRoutePage() {
  const { slug } = useParams({ from: '/admin_/events/$slug_/orby' })
  return <SupportDesk eventSlug={slug} />
}

const orbyRoute = createFileRoute('/admin_/events/$slug_/orby')({
  component: OrbyRoutePage,
})

Object.assign(orbyRoute.options, { path: '/admin/events/$slug/orby' })

export const Route = orbyRoute as typeof orbyRoute & {
  readonly options: { readonly path: string }
}
