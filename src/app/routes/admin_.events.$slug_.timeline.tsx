import { createFileRoute } from '@tanstack/react-router'

import ProgrammeTimelinePage from '../features/admin/ProgrammeTimelinePage'
import { programmeTimelineSearchValidator } from './-programme-timeline-search-validator'

import type {} from '../routeTree.gen'

const programmeTimelineRoute = createFileRoute('/admin_/events/$slug_/timeline')({
  validateSearch: programmeTimelineSearchValidator,
  component: ProgrammeTimelinePage,
})

Object.assign(programmeTimelineRoute.options, { path: '/admin/events/$slug/timeline' })

export const Route = programmeTimelineRoute as typeof programmeTimelineRoute & {
  readonly options: { readonly path: string }
}
