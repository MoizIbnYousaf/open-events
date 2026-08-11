import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'

import { buttonVariants } from '../components/ui/button-variants'
import { Card, CardContent } from '../components/ui/card'
import { Kbd } from '../components/ui/kbd'
import { PaperStack } from '../components/ui/paper-stack'
import { linkVariants } from '../components/ui/link-variants'
import { StatusLive } from '../components/ui/status-live'

/**
 * The router's not-found surface, registered as `defaultNotFoundComponent` so
 * an unmatched URL lands inside the design system instead of TanStack's bare
 * built-in text. Deliberately the same card grammar as `RouteErrorState`: an
 * unknown address, a route crash and an app crash should read as one family.
 *
 * A missing page is NOT an error, so this speaks through a polite status
 * region rather than an alert — there is nothing to interrupt for, and there
 * is no retry that could do anything but 404 again. Two ways out instead, one
 * per audience.
 *
 * It ships in the eager main chunk (router.tsx is eager), so it is restricted
 * to Card / Button / the link recipe / StatusLive / PaperStack and CSS-drawn
 * artwork: no icon module, no image asset. The primary way out takes only the button
 * CLASS recipe, which costs the chunk nothing the primitive was not already
 * spending.
 */

/**
 * The same h1 the four `AdminStates` flavours use. A page state is a PAGE, and
 * C0 §2 gives a page title one size — this family sat at 16px/500 while the
 * forbidden and expired cards next door sat at 20px/600, so the router's 404
 * and the organizer's 404 read as two products answering the same moment.
 */
const titleClass = 'font-heading text-xl leading-tight font-semibold'

export function NotFoundState() {
  // The tab is where a reader is told which page they are on when the page is
  // not on screen, and an unmatched URL kept the title of whatever they were
  // reading before (H11 / WCAG 2.4.2). An effect rather than a route option:
  // this component is the router's `defaultNotFoundComponent` and is rendered
  // from several boundaries, so the title belongs to the state, not to a route.
  useEffect(() => {
    document.title = 'Not found — Open Events'
  }, [])
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <Card>
        <CardContent className="grid justify-items-start gap-3">
          <PaperStack className="mb-1" />
          <h1 className={titleClass}>Not found</h1>
          <StatusLive>
            This address does not match any screen in Open Events. It may have been mistyped, or the
            page it pointed at may have moved.
          </StatusLive>
          <div className="flex flex-wrap items-center gap-3">
            {/* A link wearing the button recipe, not a Button rendering a
                link. Going through the primitive merged button semantics onto
                the anchor and this way out announced as "Go to the start,
                button" — promising that something would happen here, when what
                actually happens is a navigation. The class recipe gives the
                weight of a primary action to an element that stays honest
                about being one. */}
            <Link to="/" className={buttonVariants()}>
              Go to the start
            </Link>
            {/* activeOptions.exact for the same reason the site header needs
                it: /admin is a prefix of every organizer screen. */}
            <Link
              to="/admin"
              activeOptions={{ exact: true }}
              className={linkVariants({ hit: true })}
            >
              Organizer sign-in
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Or press{' '}
            {/* Announced, unlike every other cap in the product: this one is
                a word in a sentence, not the decoration of a named control. */}
            <Kbd aria-hidden={false}>⌘K</Kbd> to search every screen by name.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
