import { createFileRoute } from '@tanstack/react-router'

import TaxonomyEditor from '../features/admin/TaxonomyEditor'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin_/events/$slug_/taxonomies')({
  component: TaxonomyEditor,
})
