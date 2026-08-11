import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppErrorBoundary from '../../../src/app/AppErrorBoundary'
import { RouteErrorState } from '../../../src/app/CrashStates'
import { reportRouteCrash } from '../../../src/app/error-reporting'
import { createQueryClient } from '../../../src/app/query-client'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'
import { routeTree } from '../../../src/app/routeTree.gen'

const ROOT = resolve(import.meta.dirname, '../../..')

function readSource(relative: string): string {
  return readFileSync(resolve(ROOT, relative), 'utf8')
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  cleanup()
})

let shouldThrow = true

function Thrower(): never {
  throw new Error('boom raw server copy')
}

function ConditionalThrower() {
  if (shouldThrow) throw new Error('boom raw server copy')
  return <p>recovered content</p>
}

function mountThrowingRoute(Component: () => React.ReactElement) {
  const rootRoute = createRootRoute()
  const route = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Component })
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultErrorComponent: RouteErrorState,
    defaultOnCatch: reportRouteCrash,
  })
  render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <RouterProvider router={router as any} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('app error boundary', () => {
  it('declares the router-level error component so matches are wrapped in a catch boundary', () => {
    const source = readSource('src/app/router.tsx')
    expect(source).toContain('defaultErrorComponent')
    expect(source).toContain('defaultOnCatch')
  })

  it('wraps the providers in a class boundary above the router', () => {
    const source = readSource('src/main.tsx')
    expect(source).toMatch(
      /<AppErrorBoundary>[\s\S]*<QueryClientProvider[^>]*client=\{queryClient\}[^>]*>[\s\S]*<RouterProvider[^>]*\/>/,
    )
  })

  it('renders a recovery surface instead of unmounting the tree when a route throws', async () => {
    mountThrowingRoute(Thrower)

    expect(
      await screen.findByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(document.body.textContent).not.toBe('')
  })

  it('never renders the raw error text', async () => {
    mountThrowingRoute(Thrower)

    await screen.findByRole('heading', { name: /something went wrong/i })
    expect(screen.queryByText(/boom raw server copy/)).toBeNull()
  })

  it('reports every caught error instead of swallowing it', async () => {
    mountThrowingRoute(Thrower)

    await screen.findByRole('heading', { name: /something went wrong/i })
    const reported = consoleErrorSpy.mock.calls.some(
      (call: readonly unknown[]) =>
        call[0] === 'unhandled UI error' && String(call[1]).includes('boom raw server copy'),
    )
    expect(reported).toBe(true)
  })

  it('recovers the route when Try again is pressed', async () => {
    const user = userEvent.setup()
    shouldThrow = true
    mountThrowingRoute(ConditionalThrower)

    await screen.findByRole('heading', { name: /something went wrong/i })
    shouldThrow = false
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText('recovered content')).toBeInTheDocument()
  })

  it('catches an error thrown above the router', () => {
    render(
      <AppErrorBoundary>
        <Thrower />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    expect(
      consoleErrorSpy.mock.calls.some(
        (call: readonly unknown[]) => call[0] === 'unhandled UI error',
      ),
    ).toBe(true)
  })
})

describe('root shell', () => {
  it('mounts the announcer and the site nav exactly once in the root route', () => {
    const source = readSource('src/app/routes/__root.tsx')
    expect(source.match(/<LiveAnnouncer \/>/g)).toHaveLength(1)
    expect(source).toMatch(/<main id="main"[\s\S]*<Outlet \/>/)
  })

  it('owns the theme provider and the toaster once, in the shell above the router', () => {
    const shell = readSource('src/main.tsx')
    expect(shell.match(/<ThemeProvider>/g)).toHaveLength(1)
    expect(shell.match(/<Toaster \/>/g)).toHaveLength(1)
    // Both outlive the router: the provider wraps it, the toaster is its
    // sibling, so a route-level crash takes neither of them down.
    expect(shell).toMatch(
      /<ThemeProvider>[\s\S]*<RouterProvider[^>]*\/>[\s\S]*<Toaster \/>[\s\S]*<\/ThemeProvider>/,
    )
    // The root route must not mount a second copy of either: two providers
    // would bind the global theme chord twice.
    const root = readSource('src/app/routes/__root.tsx')
    expect(root).not.toMatch(/<ThemeProvider/)
    expect(root).not.toMatch(/<Toaster/)
  })

  it('keeps the skip link as the first focusable element', async () => {
    const user = userEvent.setup()
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      defaultErrorComponent: RouteErrorState,
      defaultOnCatch: reportRouteCrash,
    })
    render(
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <RouterProvider router={router as any} />
        </QueryClientProvider>
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByText('Skip to content')).toBeInTheDocument())

    await user.tab()
    expect(screen.getByText('Skip to content')).toHaveFocus()
  })
})
