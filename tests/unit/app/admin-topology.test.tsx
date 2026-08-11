import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { routeTree } from '../../../src/app/routeTree.gen'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'

const EVENT_CONFIG_DTO = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: 'demo-conf-2026',
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
  websiteUrl: 'https://example.test/demo-conf-2026',
  organizerContact: 'programme@example.test',
  venue: 'DemoConf Convention Center, Berlin',
  eventType: 'conference',
}

const TAXONOMY_DTO = {
  eventId: EVENT_CONFIG_DTO.id,
  items: [
    {
      id: 'f0000000-0000-4000-8000-000000000501',
      kind: 'format',
      key: 'workshop',
      label: 'Workshop',
      position: 0,
    },
    {
      id: 'f0000000-0000-4000-8000-000000000502',
      kind: 'format',
      key: 'talk',
      label: 'Talk',
      position: 1,
    },
    {
      id: 'f0000000-0000-4000-8000-000000000503',
      kind: 'track',
      key: 'workshop',
      label: 'Workshop',
      position: 0,
    },
    {
      id: 'f0000000-0000-4000-8000-000000000504',
      kind: 'track',
      key: 'talk',
      label: 'Talk',
      position: 1,
    },
  ],
}

const CRITERIA_DTO = [
  {
    id: 'e0000000-0000-4000-8000-000000000701',
    eventId: EVENT_CONFIG_DTO.id,
    name: 'Overall fit',
    weight: 1,
    position: 0,
  },
]

const ROUNDS_DTO = [
  {
    id: 'e0000000-0000-4000-8000-000000000702',
    eventId: EVENT_CONFIG_DTO.id,
    number: 1,
    name: 'Round 1',
    status: 'open',
  },
]

let fetchHandler: (url: string, init?: RequestInit) => Response

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function mountRealRouter(initialPath: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
}

function renderReal(router: ReturnType<typeof mountRealRouter>) {
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

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
      return jsonResponse(EVENT_CONFIG_DTO)
    }
    if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
      return jsonResponse(TAXONOMY_DTO)
    }
    if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/criteria') {
      return jsonResponse(CRITERIA_DTO)
    }
    if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/rounds') {
      return jsonResponse(ROUNDS_DTO)
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      return fetchHandler(requestUrl(input), init)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('real generated router topology', () => {
  it('renders the event config at /admin/events/demo-conf-2026 without the login screen', async () => {
    const router = mountRealRouter('/admin/events/demo-conf-2026')
    await router.load()
    renderReal(router)

    expect(await screen.findByLabelText('Venue')).toHaveValue('DemoConf Convention Center, Berlin')
    expect(screen.queryByLabelText('Organizer secret')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/events/demo-conf-2026')
  })

  it('renders the taxonomy editor at /admin/events/demo-conf-2026/taxonomies without login or config forms', async () => {
    const router = mountRealRouter('/admin/events/demo-conf-2026/taxonomies')
    await router.load()
    renderReal(router)

    expect(await screen.findByText('Format')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Key')).toHaveLength(4)
    expect(screen.queryByLabelText('Organizer secret')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Venue')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/events/demo-conf-2026/taxonomies')
  })

  it('navigates from event config to taxonomies through the real generated router', async () => {
    const router = mountRealRouter('/admin/events/demo-conf-2026')
    await router.load()
    renderReal(router)

    expect(await screen.findByLabelText('Venue')).toBeInTheDocument()

    await router.navigate({
      to: '/admin/events/$slug/taxonomies',
      params: { slug: 'demo-conf-2026' },
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/events/demo-conf-2026/taxonomies')
    })
    expect(await screen.findByText('Format')).toBeInTheDocument()
    expect(screen.queryByLabelText('Venue')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Organizer secret')).not.toBeInTheDocument()
  })

  it('serves the admin login form at /admin through the real generated router', async () => {
    const router = mountRealRouter('/admin')
    await router.load()
    renderReal(router)

    expect(await screen.findByLabelText('Organizer secret')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin')
  })

  it('reaches the review committee from the event config through the organizer navigation', async () => {
    const user = userEvent.setup()
    const router = mountRealRouter('/admin/events/demo-conf-2026')
    await router.load()
    renderReal(router)

    expect(await screen.findByLabelText('Venue')).toBeInTheDocument()
    // REQ-009's organizer half has to be clickable, not merely routable: the
    // event config is the one organizer nav surface, so the committee hangs
    // off it beside the taxonomies it already offers.
    await user.click(screen.getByRole('link', { name: 'Manage review committee' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/events/demo-conf-2026/evaluations')
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: /review committee/i }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Overall fit')).toBeInTheDocument()
  })

  it('navigates from the event config to taxonomies by clicking Manage taxonomies', async () => {
    const user = userEvent.setup()
    const router = mountRealRouter('/admin/events/demo-conf-2026')
    await router.load()
    renderReal(router)

    expect(await screen.findByLabelText('Venue')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Manage taxonomies' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/events/demo-conf-2026/taxonomies')
    })
    expect(await screen.findByText('Format')).toBeInTheDocument()
  })

  it('navigates back from taxonomies to the event config', async () => {
    const user = userEvent.setup()
    const router = mountRealRouter('/admin/events/demo-conf-2026/taxonomies')
    await router.load()
    renderReal(router)

    expect(await screen.findByText('Format')).toBeInTheDocument()
    await user.click(screen.getByText(/back to event settings/i))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/events/demo-conf-2026')
    })
    expect(await screen.findByLabelText('Venue')).toBeInTheDocument()
  })
})
