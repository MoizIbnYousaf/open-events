import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import AppErrorBoundary from './app/AppErrorBoundary'
import { MaybeClerk } from './app/maybe-clerk'
import { createRouter } from './app/router'
import { queryClient } from './app/query-client'
import { ThemeProvider } from './components/ui/theme-provider'
import { Toaster } from './components/ui/sonner'
import { CommandMenu } from './app/features/command/CommandMenu'
import type { NavigateCommand } from './app/features/command/command-actions'
import { ProductTour } from './app/features/tour/ProductTour'
import './index.css'

const router = createRouter()

function navigateFromCommand(action: NavigateCommand): void {
  void router.navigate({ to: action.to, params: action.params })
}

function navigateFromTour(route: string, params?: Readonly<Record<string, string>>): void {
  void router.navigate({ to: route, params } as Parameters<typeof router.navigate>[0])
}

// The application shell. Everything that outlives a route lives here rather
// than in the router's root route: the theme and the toast stack are owned by
// the app, not by whichever route happens to be matched, so a router-level
// crash can neither drop the stored scheme nor take the toaster down with it.
// The toaster is a sibling of the router for the same reason, and sits inside
// ThemeProvider so a card is drawn in the scheme the app is actually showing.
function appTree(): ReactNode {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
        <CommandMenu onNavigate={navigateFromCommand} floating={true} />
        <ProductTour onNavigate={navigateFromTour} />
        <Toaster />
      </ThemeProvider>
    </AppErrorBoundary>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MaybeClerk>{appTree()}</MaybeClerk>
  </StrictMode>,
)
