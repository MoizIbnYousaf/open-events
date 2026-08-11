import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import SpeakerNav from '../features/public/SpeakerNav'
import LandingEventState from '../features/public/LandingEventState'

export const Route = createFileRoute('/')({
  component: IndexPage,
})

function IndexPage() {
  useEffect(() => {
    document.title = 'DemoConf 2026 — SpeakerOps'
  }, [])

  // The landing page is outside the public shell, so it carries the same
  // speaker nav itself: the portal must be reachable from the front door in
  // every event state, including while the event card is still loading.
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="grid gap-4">
        <LandingEventState />
        <SpeakerNav />
      </div>
    </div>
  )
}
