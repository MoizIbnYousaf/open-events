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
    // The reading measure is capped at max-w-3xl and the gutters grow in three
    // steps rather than one: a phone gets 16px of air, a tablet gets vertical
    // room, and only a desktop pays for 24px side gutters. One rhythm for
    // every public page, so the column never jumps as the reader moves
    // between the portal, the call for papers and the schedule.
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:py-6 lg:px-6 lg:py-8">
      <div className="grid min-w-0 gap-4 md:gap-6">
        <SpeakerNav />
        <Outlet />
      </div>
    </div>
  )
}
