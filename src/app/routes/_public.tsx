import { createFileRoute, Outlet } from '@tanstack/react-router'

import type {} from '../routeTree.gen'

/** Pathless public shell: brand/main live in __root; public pages render here. */
export const Route = createFileRoute('/_public')({
  component: PublicShell,
})

function PublicShell() {
  return <Outlet />
}
