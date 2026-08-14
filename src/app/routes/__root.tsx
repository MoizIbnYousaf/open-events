import { lazy, Suspense, useEffect } from 'react'
import { Link, createRootRoute, Outlet } from '@tanstack/react-router'

import { Button } from '../../components/ui/button'
import { Kbd } from '../../components/ui/kbd'
import { linkVariants } from '../../components/ui/link-variants'
import { LiveAnnouncer } from '../../components/ui/live-announcer'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { isClerkConfigured } from '../../lib/clerk'
import {
  COMMAND_MENU_OPEN_EVENT,
  PALETTE_TRIGGER_TOUR_TARGET,
} from '../features/command/CommandMenu'
import { TOUR_TOGGLE_EVENT } from '../features/tour/ProductTour'

const ClerkNavControls = lazy(() => import('../features/nav/ClerkNavControls'))

export const Route = createRootRoute({
  component: Root,
})

/**
 * Hoisted so the opening tag stays on one line: `shell-contract.test.tsx`
 * matches `<main id="main"` as a literal against this file's source, which is
 * how the skip-link target and the single content landmark are pinned.
 */
const MAIN_CLASS =
  'flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-gutter:stable] lg:[body:has([role=dialog][data-open])_&]:overflow-hidden'

/**
 * The site-nav link's own recipe. `linkVariants` sets no font size, and neither
 * does the toolbar row, so without this the only 16px text in the product sat
 * in the 56px strip every page shows, beside a 14px button. C0 §2 gives chrome
 * two sizes; this is the smaller one.
 */
const SITE_LINK_CLASS = 'text-sm text-foreground'

/**
 * The site chrome.
 *
 * Desktop is an app frame, not a document: the shell is exactly one viewport
 * tall, the 56px toolbar is pinned, and scrolling is delegated to the content
 * region so a workspace rail can stay put beside it. Below `lg` that inverts —
 * the document scrolls again, because a phone browser's own chrome already
 * owns the top of the screen and a locked frame there fights the URL bar.
 *
 * The toolbar row itself wraps below `sm` rather than compressing: four
 * controls and a wordmark do not fit across 390px, and a wrapped second line is
 * honest where a horizontal scrollbar on the page chrome is not.
 *
 * From `sm` up it is one 56px line, and the ONE elastic thing in it is the
 * palette trigger. That is what makes the single line safe: the wordmark and
 * the trailing cluster hold their intrinsic widths, so if the trigger were also
 * rigid the row would have no legal layout between 640px and 767px and the
 * whole document would scroll sideways on every route. The trigger therefore
 * sits in a `flex-1` slot capped at its design width, and gives that width back
 * to its neighbours a pixel at a time instead of pushing them off-screen.
 *
 * Glyphs are drawn inline, in file. This module is the entry chunk, which
 * `scripts/perf-check.mjs` holds to a gzip budget and greps for third-party
 * icon-library names.
 */
function Root() {
  useEffect(() => {
    document.documentElement.lang = 'en'
  }, [])

  return (
    <div className="flex min-h-svh flex-col lg:h-svh lg:overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-popover focus:outline-hidden focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-background">
        <div className="flex min-h-[var(--navbar-height)] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:h-[var(--navbar-height)] sm:flex-nowrap sm:py-0">
          {/* The wordmark is a link home, never a heading: every page owns its own h1. */}
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
            >
              S
            </span>
            <span className="text-sm font-medium text-foreground">Open Events</span>
          </Link>
          {/* A visible way into the command palette; ⌘K/Ctrl+K still works
              everywhere. A real button, not a decorative field: it opens the
              dialog that owns the actual search box.

              The elastic slot is the wrapper, not the button: `Button` is
              `shrink-0` by design, and a control that quietly shrank would be
              a surprise everywhere else it is used. So the row's flexibility
              lives in a box the row owns, and the button simply fills it. */}
          <div className="hidden min-w-0 flex-1 sm:flex sm:max-w-64">
            <Button
              variant="outline"
              data-tour={PALETTE_TRIGGER_TOUR_TARGET}
              onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_MENU_OPEN_EVENT))}
              className="w-full justify-start gap-2 font-normal text-muted-foreground"
            >
              <svg
                data-icon="inline-start"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.75 4.25a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z" />
                <path d="m19.75 19.75-4.4-4.4" />
              </svg>
              {/* Truncates rather than pushing: the label is the part of the
                  row that may give ground, and it keeps the glyph and the cap
                  — the two things that say what the control is — visible at
                  every width the single line survives. */}
              <span className="flex-1 truncate text-left">Search destinations…</span>
              {/* Announced, unlike the rail's cap: this trigger publishes no
                  `aria-keyshortcuts`, so the chord reaches assistive tech only
                  through the button's accessible name — "Search destinations… ⌘K". */}
              <Kbd aria-hidden={false}>⌘K</Kbd>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:ml-auto sm:flex-nowrap">
            {/* The tour's one visible door: it toggles the overlay and never
                auto-opens, so a control in the header is what makes it real. */}
            <Button
              variant="ghost"
              size="sm"
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
              <Link
                to="/admin"
                activeOptions={{ exact: true }}
                className={linkVariants({ hit: true, className: SITE_LINK_CLASS })}
              >
                Organizer sign-in
              </Link>
            </nav>
            {/* After the site nav so the visible navigation is what a
                  first-time visitor meets first; the palette accelerates it. */}
            <ThemeToggle />
            {isClerkConfigured() ? (
              <Suspense fallback={null}>
                <ClerkNavControls />
              </Suspense>
            ) : null}
          </div>
        </div>
      </header>
      {/* The single scroller at desktop width. `overscroll-contain` stops a
          flick inside the content region from chaining out to the frame, and a
          stable gutter keeps the toolbar from shifting when a page grows past
          one screen. */}
      <main id="main" tabIndex={-1} className={MAIN_CLASS}>
        <Outlet />
      </main>
      {/* Outside <main> so the #main skip target is unchanged, and inside the
            root route so it survives every route transition. */}
      <LiveAnnouncer />
    </div>
  )
}
