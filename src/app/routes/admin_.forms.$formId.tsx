import { createFileRoute } from '@tanstack/react-router'

import BuilderEditor from '../features/builder/BuilderEditor'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin_/forms/$formId')({ component: BuilderEditor })
