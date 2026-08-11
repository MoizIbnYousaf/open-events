import { createFileRoute } from '@tanstack/react-router'

import EventConfig from '../features/admin/EventConfig'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin_/events/$slug')({ component: EventConfig })
