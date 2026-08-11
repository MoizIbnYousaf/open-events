import { Component, type ErrorInfo, type ReactNode } from 'react'

import { AlertLive } from '../components/ui/alert-live'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { reportRouteCrash } from './error-reporting'

interface AppErrorBoundaryProps {
  readonly children: ReactNode
}

interface AppErrorBoundaryState {
  readonly error: Error | null
}

const GENERIC_COPY = 'This page could not be displayed. Try again, or go back to the start.'

/**
 * Covers what the router cannot: RouterProvider's own internals, the query
 * provider, and anything else above the route tree. Mounted outside the
 * providers in main.tsx so a failure in either is still caught.
 *
 * The fallback lives in this file rather than in a separate module so the
 * recovery control and the callback that drives it can be read together. It
 * ships in the main chunk, so it may only use Card / Button / AlertLive —
 * heavier primitives would spend the entry-chunk gzip budget enforced by
 * scripts/perf-check.mjs.
 *
 * Copy is fixed and generic: the repo forbids rendering raw server text into
 * the UI. The real error is not hidden, it goes to reportRouteCrash.
 */
export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRouteCrash(error, { componentStack: info.componentStack ?? undefined })
  }

  /** Clears the caught error so the subtree re-renders — the real recovery. */
  private readonly resetErrorBoundary = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <Card className="mx-auto mt-8 w-full max-w-md">
        <CardContent className="grid justify-items-start gap-3">
          {/* The page-state h1, same as `CrashStates`/`NotFoundState`/
              `AdminStates`: this card answers the same kind of moment they do
              and has no reason to be a size smaller (C0 §2). */}
          <h1 className="font-heading text-xl leading-tight font-semibold">Something went wrong</h1>
          <AlertLive>{GENERIC_COPY}</AlertLive>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={this.resetErrorBoundary}>
              Try again
            </Button>
            {/* A failed chunk load also lands here, and only a reload fixes that. */}
            <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }
}
