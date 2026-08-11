import { createFileRoute } from '@tanstack/react-router'

import PublicSpeakerDetailPage from '../../features/public/PublicSpeakerDetailPage'

import type {} from '../../routeTree.gen'

const speakerDetailRoute = createFileRoute('/_public/speakers/$eventSlug/$contactId')({
  component: PublicSpeakerDetailPage,
})

Object.assign(speakerDetailRoute.options, { path: '/speakers/$eventSlug/$contactId' })

export const Route = speakerDetailRoute as typeof speakerDetailRoute & {
  readonly options: { readonly path: string }
}
