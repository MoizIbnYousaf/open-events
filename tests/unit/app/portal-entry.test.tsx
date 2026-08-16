import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { routeTree } from '../../../src/app/routeTree.gen'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'

// Reachability contract: the speaker portal and the headshot page are the only
// surfaces that render the onboarding checklist, the headshot upload, and the
// calendar-invite download. A surface reachable only by typing its URL is not
// shipped, so every public page and the landing page must link to them.

const EVENT_DTO = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: 'demo-conf-2026',
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
  websiteUrl: 'https://example.test/demo-conf-2026',
  organizerContact: 'programme@example.test',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.startsWith('/api/events/')) return Promise.resolve(jsonResponse(EVENT_DTO))
      return Promise.resolve(
        jsonResponse({ error: { code: 'unauthorized', message: 'no session' } }, 401),
      )
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mountAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('speaker surface reachability', () => {
  it('links the public shell to the portal and the headshot page', async () => {
    await mountAt('/start')

    const nav = await screen.findByRole('navigation', { name: /speaker/i })
    expect(nav).toHaveTextContent(/portal/i)
    const portalLink = screen.getByRole('link', { name: /speaker portal/i })
    expect(portalLink).toHaveAttribute('href', '/portal')
    const headshotLink = screen.getByRole('link', { name: /headshot/i })
    expect(headshotLink).toHaveAttribute('href', '/headshot')
  })

  it('keeps the same way in from the call-for-papers page', async () => {
    await mountAt('/cfp/demo-conf-2026/cfp')

    const portalLink = await screen.findByRole('link', { name: /speaker portal/i })
    expect(portalLink).toHaveAttribute('href', '/portal')
  })

  it('offers the portal from the landing page', async () => {
    await mountAt('/')

    const portalLink = await screen.findByRole('link', { name: /speaker portal/i })
    expect(portalLink).toHaveAttribute('href', '/portal')
  })
})
