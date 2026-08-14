import { createFileRoute } from '@tanstack/react-router'

import type {} from '../../routeTree.gen'

function EmbedRedirect() {
  // The Worker serves the real embed HTML at /embed/:id. This route exists so
  // the SPA can deep-link; the iframe src hits the API path directly.
  return null
}

const embedRoute = createFileRoute('/_public/embed/$embedId')({
  component: EmbedRedirect,
})

Object.assign(embedRoute.options, { path: '/embed/$embedId' })

export const Route = embedRoute as typeof embedRoute & {
  readonly options: { readonly path: string }
}
