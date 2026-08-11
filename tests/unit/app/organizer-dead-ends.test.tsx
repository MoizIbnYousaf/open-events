import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AgendaAdminPage from '../../../src/app/features/admin/AgendaAdminPage'
import EvaluationCommitteePage from '../../../src/app/features/admin/EvaluationCommitteePage'
import { Route as ReadinessRoute } from '../../../src/app/routes/admin_.events.$slug_.readiness'

/**
 * V4-N4: a dead end is a PAGE, and the three routes below rendered theirs
 * INSIDE the organizer rail — a card sitting in a shell full of destinations the
 * reader is no longer allowed to open, while their sibling routes rendered the
 * same moment bare. One anatomy, everywhere: the illustrated card, one h1, no
 * shell around it.
 */

const EVENT_SLUG = 'demo-conf-2026'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function mountRoute(path: string, component: () => ReactNode) {
  const rootRoute = createRootRoute()
  const routes = [
    createRoute({ getParentRoute: () => rootRoute, path, component }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/admin',
      component: () => <div>Organizer sign-in</div>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/admin/events/$slug',
      component: () => <div>Event settings</div>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/admin/events/$slug/taxonomies',
      component: () => <div>Taxonomy editor</div>,
    }),
  ]
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({
      initialEntries: [path.replace('$slug', EVENT_SLUG)],
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
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: 'unauthorized', message: 'raw session copy' } }, 401),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const ROUTES = [
  {
    name: '/agenda',
    path: '/admin/events/$slug/agenda',
    component: () => <AgendaAdminPage eventSlug={EVENT_SLUG} />,
  },
  {
    name: '/evaluations',
    path: '/admin/events/$slug/evaluations',
    component: () => <EvaluationCommitteePage />,
  },
  {
    name: '/readiness',
    path: '/admin/events/$slug/readiness',
    // The real route component, shell and all: the shell is exactly what the
    // finding was about.
    component: ReadinessRoute.options.component as () => ReactNode,
  },
] as const

describe('signed-out organizer routes render one bare dead end', () => {
  it.each(ROUTES)('$name replaces the whole page, rail included', async ({ path, component }) => {
    await mountRoute(path, component)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Session expired' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument()
    // No rail behind the card: the nav landmark AppShell owns is absent, and so
    // is every destination it would have offered.
    expect(screen.queryByRole('navigation', { name: 'Event' })).toBeNull()
    expect(screen.queryByRole('link', { name: /taxonomies/i })).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('raw session copy')
    // V7-TITLES / H11: the tab names the state the page is actually in, not the
    // page the reader was refused.
    await waitFor(() => expect(document.title).toBe('Session expired — SpeakerOps'))
  })
})
