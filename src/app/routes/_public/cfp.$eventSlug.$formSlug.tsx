import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { PublicCfpPage as PublicCfpPageComponent } from '../../features/public/PublicCfpPage'

import type {} from '../../routeTree.gen'

export const Route = createFileRoute('/_public/cfp/$eventSlug/$formSlug')({
  component: PublicCfpPageComponent,
})

/** Named page export for route-level consumers; identical to the route component. */
export const PublicCfpPage = Route.options.component as ComponentType<{
  readonly eventSlug?: string
  readonly formSlug?: string
}>
