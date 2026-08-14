import { createFileRoute } from '@tanstack/react-router'

import PublicSessionsPage from '../../features/public/PublicSessionsPage'

import type {} from '../../routeTree.gen'

const sessionsRoute = createFileRoute('/_public/sessions/$eventSlug')({
  component: PublicSessionsPage,
})

Object.assign(sessionsRoute.options, { path: '/sessions/$eventSlug' })

export const Route = sessionsRoute as typeof sessionsRoute & {
  readonly options: { readonly path: string }
}
