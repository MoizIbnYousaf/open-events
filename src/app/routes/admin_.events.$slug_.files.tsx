import { createFileRoute, useParams } from '@tanstack/react-router'

import FilesPage from '../features/admin/FilesPage'

import type {} from '../routeTree.gen'

function FilesRoutePage() {
  const { slug } = useParams({ from: '/admin_/events/$slug_/files' })
  return <FilesPage eventSlug={slug} />
}

const filesRoute = createFileRoute('/admin_/events/$slug_/files')({
  component: FilesRoutePage,
})

Object.assign(filesRoute.options, { path: '/admin/events/$slug/files' })

export const Route = filesRoute as typeof filesRoute & {
  readonly options: { readonly path: string }
}
