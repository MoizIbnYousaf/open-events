import { Link } from '@tanstack/react-router'

import { AlertLive } from '../components/ui/alert-live'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'

const titleClass = 'font-heading text-base leading-snug font-medium'
const GENERIC_COPY = 'This page could not be displayed. Try again, or go back to the start.'

/**
 * The router's crash surface. It ships in the main chunk (router.tsx is eager),
 * so it may only use Card / Button / AlertLive — dialog.tsx and select.tsx pull
 * lucide-react and would breach the entry-chunk purity budget in
 * scripts/perf-check.mjs.
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
          <Link
            to="/"
            className="min-h-6 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to the start
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
