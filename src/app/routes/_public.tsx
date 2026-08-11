import { createFileRoute, Outlet } from '@tanstack/react-router'

import SpeakerNav from '../features/public/SpeakerNav'

import type {} from '../routeTree.gen'

/** Pathless public shell: brand/main live in __root; public pages render here. */
export const Route = createFileRoute('/_public')({
  component: PublicShell,
})

/**
 * The speaker nav is part of the shell rather than of any one page: /portal is
 * the only surface carrying the onboarding checklist, the headshot upload and
 * the calendar-invite download, so every public page has to offer a way in.
 */
function PublicShell() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="grid gap-6">
        <SpeakerNav />
        <Outlet />
      </div>
    </div>
  )
}
