import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { PublicStartPage as PublicStartPageComponent } from '../../features/public/PublicStartPage'

import type {} from '../../routeTree.gen'

export const Route = createFileRoute('/_public/start')({
  component: PublicStartPageComponent,
})

/** Named page export for route-level consumers; identical to the route component. */
export const PublicStartPage = Route.options.component as ComponentType
