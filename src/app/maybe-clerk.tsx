import { lazy, Suspense, type ReactNode } from 'react'

import { isClerkConfigured } from '../lib/clerk'

const ClerkAppRoot = lazy(() => import('./clerk-root'))

/** Wraps the tree in Clerk only when a publishable key is present. */
export function MaybeClerk({ children }: { readonly children: ReactNode }) {
  if (!isClerkConfigured()) return children
  return (
    <Suspense fallback={children}>
      <ClerkAppRoot>{children}</ClerkAppRoot>
    </Suspense>
  )
}
