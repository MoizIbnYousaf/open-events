import { lazy, Suspense, type ReactNode } from 'react'

import { isClerkConfigured } from '../lib/clerk'

const ClerkAppRoot = lazy(() => import('./clerk-root'))

/**
 * Wraps the tree in Clerk only when a publishable key is present.
 *
 * The fallback must not be `children`. Rendering the app as the Suspense
 * fallback and again inside ClerkProvider remounts every effect (queries,
 * theme) and trips React 19's "state update on a component that hasn't
 * mounted yet" — which flakes `pnpm e2e` smoke.
 */
export function MaybeClerk({ children }: { readonly children: ReactNode }) {
  if (!isClerkConfigured()) return children
  return (
    <Suspense fallback={null}>
      <ClerkAppRoot>{children}</ClerkAppRoot>
    </Suspense>
  )
}
