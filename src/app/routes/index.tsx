import { useEffect } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import SpeakerNav from '../features/public/SpeakerNav'
import LandingEventState from '../features/public/LandingEventState'
import { linkVariants } from '../../components/ui/link-variants'

export const Route = createFileRoute('/')({
  component: IndexPage,
})

function IndexPage() {
  useEffect(() => {
    document.title = 'DemoConf 2026 — Open Events'
  }, [])

  // The landing page is outside the public shell, so it carries the same
  // speaker nav itself: the portal must be reachable from the front door in
  // every event state, including while the event card is still loading. It
  // also repeats the shell's three-step column rhythm so the front door and
  // the pages behind it share one measure.
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:py-6 lg:px-6 lg:py-8">
      <div className="grid min-w-0 gap-4 md:gap-6">
        <LandingEventState />
        {/*
          /start had no inbound link anywhere in the tree — a speaker who
          closed their magic-link email could only reach it by typing the URL.
          The front door is the honest place for it: it names the destination
          in the reader's terms rather than adding a nav destination for a
          surface that is a redirect target, so the nav model is untouched.
        */}
        <p className="text-sm text-muted-foreground">
          Already submitted a proposal?{' '}
          <Link to="/start" className={linkVariants()}>
            Email me a sign-in link
          </Link>
        </p>
        <SpeakerNav />
      </div>
    </div>
  )
}
