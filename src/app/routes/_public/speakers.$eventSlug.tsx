import { createFileRoute } from '@tanstack/react-router'

import PublicSpeakersPage from '../../features/public/PublicSpeakersPage'

import type {} from '../../routeTree.gen'

const speakersRoute = createFileRoute('/_public/speakers/$eventSlug')({
  component: PublicSpeakersPage,
})

Object.assign(speakersRoute.options, { path: '/speakers/$eventSlug' })

export const Route = speakersRoute as typeof speakersRoute & {
  readonly options: { readonly path: string }
}
