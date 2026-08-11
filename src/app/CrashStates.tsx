import { Link } from '@tanstack/react-router'

import { AlertLive } from '../components/ui/alert-live'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { linkVariants } from '../components/ui/link-variants'

/** The page-state h1, shared with `NotFoundState` and `AdminStates` (C0 §2). */
const titleClass = 'font-heading text-xl leading-tight font-semibold'
const GENERIC_COPY = 'This page could not be displayed. Try again, or go back to the start.'

/**
 * The router's crash surface. It ships in the main chunk (router.tsx is eager),
 * so it is restricted to the primitives that carry no icon module of their own
 * — Card, Button, the link recipe, AlertLive — because `scripts/perf-check.mjs` holds
 * that chunk to a gzip budget and greps it for third-party icon-library names.
 *
 * Same card grammar as `NotFoundState`, deliberately: a crash and an unknown
 * address are two members of one family, and a reader who meets both should
 * recognise the second.
 *
 * Copy is fixed and generic on purpose: the repo's own contract forbids
 * rendering raw server text into the UI. The real error is not hidden, it is
 * reported through reportRouteCrash.
 */

interface RouteErrorStateProps {
  readonly reset?: () => void
}

/** Router-level error component. TanStack passes `reset` from its CatchBoundary. */
export function RouteErrorState({ reset }: RouteErrorStateProps) {
  return (
    <Card>
      <CardContent className="grid justify-items-start gap-3">
        <h1 className={titleClass}>Something went wrong</h1>
        <AlertLive>{GENERIC_COPY}</AlertLive>
        <div className="flex flex-wrap items-center gap-3">
          {reset === undefined ? null : (
            <Button type="button" variant="outline" onClick={reset}>
              Try again
            </Button>
          )}
          <Link to="/" className={linkVariants({ hit: true })}>
            Go to the start
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
