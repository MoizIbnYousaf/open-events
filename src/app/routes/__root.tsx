import { useEffect } from 'react'
import { Link, createRootRoute, Outlet } from '@tanstack/react-router'

import { Button } from '../../components/ui/button'
import { LiveAnnouncer } from '../../components/ui/live-announcer'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { COMMAND_MENU_OPEN_EVENT } from '../features/command/CommandMenu'
import { TOUR_TOGGLE_EVENT } from '../features/tour/ProductTour'

export const Route = createRootRoute({
  component: Root,
})

const SITE_LINK_CLASS =
  'min-h-6 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

function Root() {
  useEffect(() => {
    document.documentElement.lang = 'en'
  }, [])

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-hidden focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="border-b bg-background">
        <div className="flex min-h-13 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          {/* The wordmark is a link home, never a heading: every page owns its own h1. */}
          <Link
            to="/"
            className="flex items-center gap-2.5 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
            >
              S
            </span>
            <span className="text-sm font-medium text-foreground">SpeakerOps</span>
          </Link>
          {/* A visible way into the command palette; ⌘K/Ctrl+K still works
              everywhere. A real button, not a decorative field: it opens the
              dialog that owns the actual search box. */}
          <Button
            variant="outline"
            data-tour="palette-trigger"
            onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_MENU_OPEN_EVENT))}
            className="hidden w-72 justify-start gap-2 font-normal text-muted-foreground sm:flex"
          >
            <svg
              data-icon="inline-start"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="flex-1 text-left">Search destinations…</span>
            <kbd className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              ⌘K
            </kbd>
          </Button>
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-4">
            {/* The tour's one visible door: it toggles the overlay and never
                auto-opens, so a control in the header is what makes it real. */}
            <Button
              variant="ghost"
              aria-haspopup="dialog"
              onClick={() => window.dispatchEvent(new CustomEvent(TOUR_TOGGLE_EVENT))}
            >
              Tour
            </Button>
            <nav aria-label="Site">
              {/* activeOptions.exact is load-bearing: Link matches by path
                    prefix by default and sets aria-current="page" itself, so
                    without it this link claims to be the current page on every
                    /admin/* organizer screen. */}
              <Link to="/admin" activeOptions={{ exact: true }} className={SITE_LINK_CLASS}>
                Organizer sign-in
              </Link>
            </nav>
            {/* After the site nav so the visible navigation is what a
                  first-time visitor meets first; the palette accelerates it. */}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      {/* Outside <main> so the #main skip target is unchanged, and inside the
            root route so it survives every route transition. */}
      <LiveAnnouncer />
    </div>
  )
}
