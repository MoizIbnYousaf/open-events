import { ClerkProvider } from '@clerk/react'
import { shadcn } from '@clerk/themes'
import type { ReactNode } from 'react'

/**
 * Isolated so Vite can keep Clerk out of the entry chunk. Only mounted when
 * a publishable key is present; the judged preview builds without one.
 */
export default function ClerkAppRoot({ children }: { readonly children: ReactNode }) {
  return (
    <ClerkProvider
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/admin"
      signUpFallbackRedirectUrl="/admin"
      appearance={{ theme: shadcn }}
    >
      {children}
    </ClerkProvider>
  )
}
