import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ReadinessPage from '../../../src/app/features/admin/ReadinessPage'

// Readiness used to handle a 401 as an ordinary load failure: an alert and a
// "Try again" that could only be refused again. Every other organizer surface
// hands an expired session back to sign-in, and this is that branch.
//
// It lives in its own file because the branch is the only part of the page that
// needs a router: the hook is called from a component that renders only when
// the session has actually expired, so the rest of the page — and the tests
// that render it bare — stay router-free.

const EVENT_SLUG = 'demo-conf-2026'

let fetchHandler: () => Response

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function mountReadiness() {
  const rootRoute = createRootRoute()
  const readinessRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/readiness',
    component: () => <ReadinessPage eventSlug={EVENT_SLUG} />,
  })
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    component: () => <div>Organizer sign-in</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([readinessRoute, adminRoute]),
    history: createMemoryHistory({
      initialEntries: [`/admin/events/${EVENT_SLUG}/readiness`],
    }),
  })
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchHandler = () => jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(fetchHandler())),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('readiness with an expired organizer session', () => {
  it('offers sign-in instead of a retry that can only be refused again', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'unauthorized', message: 'raw session copy' } }, 401)
    await mountReadiness()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Session expired' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('raw session copy')
  })

  it('still treats an ordinary failure as a retryable one', async () => {
    await mountReadiness()

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load readiness.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Session expired' })).toBeNull()
  })
})
