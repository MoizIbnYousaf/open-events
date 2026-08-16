import { createFileRoute } from '@tanstack/react-router'

import AdminLogin from '../features/admin/AdminLogin'

import type {} from '../routeTree.gen'

export const Route = createFileRoute('/admin')({ component: AdminLogin })
