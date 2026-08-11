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
import { NotFoundState } from '../../../src/app/NotFoundState'
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

/** The real router on an unmatched URL: the designed 404 inside the real shell. */
async function mountNotFound() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/no-such-screen'] }),
    defaultErrorComponent: RouteErrorState,
    defaultOnCatch: reportRouteCrash,
    defaultNotFoundComponent: NotFoundState,
  })
  render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <RouterProvider router={router as any} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
  await screen.findByRole('heading', { level: 1, name: 'Not found' })
}

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

  it('registers a not-found component so an unmatched URL never falls through', () => {
    const source = readSource('src/app/router.tsx')
    expect(source).toContain('defaultNotFoundComponent')
  })

  // V8-N2: the tab is where a reader is told which page they are on when the
  // page is not on screen, and an unmatched URL kept the title of whatever they
  // were reading before it (WCAG 2.4.2).
  it('titles the tab for the state, not for the page the reader came from', async () => {
    document.title = 'Your submissions — SpeakerOps'
    await mountNotFound()

    await waitFor(() => expect(document.title).toBe('Not found — SpeakerOps'))
  })

  it('lands an unknown URL on a designed card with a way out, not on an alert', async () => {
    await mountNotFound()

    expect(await screen.findByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // A missing page is not an error: nothing to interrupt for, and no retry
    // that could do anything but 404 again.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(/does not match any screen/i)
    // The primary way out is a LINK wearing the button recipe. Rendering it
    // through the Button primitive merged button semantics onto the anchor, so
    // a navigation announced as "button" — promising an action where the truth
    // is a destination. It keeps the weight of a primary action and the href it
    // navigates to; only the role it claims changed.
    const wayOut = screen.getByRole('link', { name: 'Go to the start' })
    expect(wayOut).toHaveAttribute('href', '/')
    expect(wayOut.className).toContain('bg-primary')
    expect(screen.queryByRole('button', { name: 'Go to the start' })).toBeNull()
    // Two: the site header's, and the card's own audience-specific way out.
    expect(screen.getAllByRole('link', { name: 'Organizer sign-in' })).toHaveLength(2)
    // …and the console is clean while it does it. This surface used to render
    // its way out as an anchor THROUGH the Button primitive, and Base UI
    // assumes a native <button> unless told otherwise, so the judged 404
    // logged a red error on every render. The anchor no longer goes through
    // the primitive at all, which removes the misuse rather than muting it —
    // and the check stays, because a future author reaching for `Button
    // render={<Link/>}` here would bring the error straight back. The
    // assertion lives HERE, in the file's first 404 render, because Base UI
    // de-duplicates each warning text for the lifetime of the module — a later
    // test would be checking a message that had already been swallowed.
    const messages = consoleErrorSpy.mock.calls.map((call: readonly unknown[]) =>
      call.map(String).join(' '),
    )
    expect(
      messages.filter((message: string) => /nativeButton|acts as a button/.test(message)),
    ).toEqual([])
  })

  it('gives the toolbar exactly one elastic slot so it never overflows the viewport', async () => {
    await mountNotFound()

    // jsdom has no layout, so the geometry itself is measured in the browser.
    // What is pinned here is the mechanism the measurement came down to: from
    // `sm` up the toolbar is one non-wrapping 56px line, and the only item in
    // it allowed to give ground is the palette slot. When the palette was a
    // rigid `w-64` and nothing else could shrink, the row's minimum width was
    // 760px and every route scrolled sideways between 640px and 759px.
    const trigger = await screen.findByRole('button', { name: /Search destinations/ })
    const slot = trigger.parentElement
    expect(slot).not.toBeNull()
    expect(slot?.className).toContain('flex-1')
    expect(slot?.className).toContain('min-w-0')
    expect(slot?.className).toContain('sm:max-w-64')
    // The button fills its slot rather than dictating a width of its own.
    expect(trigger.className).toContain('w-full')
    expect(trigger.className).not.toMatch(/(^|\s)w-64(\s|$)/)
    const row = slot?.parentElement
    expect(row?.className).toContain('flex-wrap')
    expect(row?.className).toContain('sm:flex-nowrap')
  })

  it('keeps the site-nav link at the chrome text size', async () => {
    await mountNotFound()

    // C0 §2 gives chrome two sizes. TextLink sets none, and neither does the
    // toolbar row, so this link inherited 16px and was the only 16px text in
    // the product — in the 56px strip every single page shows.
    const [siteLink] = screen.getAllByRole('link', { name: 'Organizer sign-in' })
    expect(siteLink?.className).toContain('text-sm')
  })

  it('locks the desktop content scroller while a dialog is open', async () => {
    await mountNotFound()

    await screen.findByRole('heading', { level: 1, name: 'Not found' })
    // Base UI locks the viewport scroller (html/body). From `lg` up the app
    // frame does not scroll at all — `main#main` does — so that lock is a
    // no-op at desktop widths and the page behind the scrim stayed a live
    // scroll container. The scroller carries its own lock, conditioned on an
    // open dialog anywhere in the document.
    const main = document.getElementById('main')
    expect(main?.className).toContain('lg:[body:has([role=dialog][data-open])_&]:overflow-hidden')
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
