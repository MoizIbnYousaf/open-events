import '@testing-library/jest-dom/vitest'
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

import { createQueryClient } from '../../../src/app/query-client'
import TaxonomyEditor from '../../../src/app/features/admin/TaxonomyEditor'

const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const TAXONOMY_DTO = {
  eventId: EVENT_ID,
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

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function fetchCall(url: string, method: string): RequestInit | undefined {
  const call = fetchMock.mock.calls.find(([input, init]) => {
    return requestUrl(input) === url && (init?.method ?? 'GET') === method
  })
  return call?.[1]
}

function dispatchBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

async function mountTaxonomy() {
  const rootRoute = createRootRoute()
  const taxonomyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/taxonomies',
    component: TaxonomyEditor,
  })
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    component: () => <div data-testid="login-redirect">Admin login</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([taxonomyRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin/events/demo-conf-2026/taxonomies'] }),
  })
  await router.load()
  const queryClient = createQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
      return jsonResponse(TAXONOMY_DTO)
    }
    if (method === 'PUT' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
      const body = JSON.parse(String(init?.body)) as { items: unknown }
      return jsonResponse({ eventId: EVENT_ID, items: body.items })
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('taxonomy editor screen', () => {
  it('renders the seeded taxonomy groups and item rows', async () => {
    await mountTaxonomy()

    expect(await screen.findByText('Format')).toBeInTheDocument()
    expect(screen.getByText('Track')).toBeInTheDocument()
    expect(screen.getAllByDisplayValue('Workshop')).toHaveLength(2)
    expect(screen.getAllByDisplayValue('Talk')).toHaveLength(2)
    expect(screen.getAllByLabelText('Key')).toHaveLength(4)
  })

  it('shows the add-first-item empty state when the event has no taxonomy items', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse({ eventId: EVENT_ID, items: [] })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountTaxonomy()

    expect(await screen.findByText(/add first item/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument()
  })

  it('rejects an empty key with an alert and focuses the first invalid row before any PUT', async () => {
    const user = userEvent.setup()
    await mountTaxonomy()

    const keys = await screen.findAllByLabelText('Key')
    await user.clear(keys[0]!)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    const invalidKey = screen.getAllByLabelText('Key')[0]
    expect(invalidKey).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(invalidKey).toHaveFocus())
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        return (
          requestUrl(input) === '/api/admin/events/demo-conf-2026/taxonomies' &&
          (init?.method ?? 'GET') === 'PUT'
        )
      }),
    ).toBe(false)
  })

  it('rejects a duplicate (kind, key) with a validation alert and stays on the screen', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse(
          { error: { code: 'validation_failed', message: 'Validation failed' } },
          400,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { router } = await mountTaxonomy()

    const keys = await screen.findAllByLabelText('Key')
    await user.clear(keys[1]!)
    await user.type(keys[1]!, 'workshop')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/events/demo-conf-2026/taxonomies')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('shows a polite Saved status and replaces local rows with the server response', async () => {
    const user = userEvent.setup()
    const serverTruth = {
      eventId: EVENT_ID,
      items: TAXONOMY_DTO.items.map((item) =>
        item.kind === 'track' && item.key === 'workshop' ? { ...item, label: 'Hands-on' } : item,
      ),
    }
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse(serverTruth)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountTaxonomy()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Deep dive')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByDisplayValue('Deep dive')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hands-on')).toBeInTheDocument()
    const put = fetchCall('/api/admin/events/demo-conf-2026/taxonomies', 'PUT')
    expect(JSON.parse(String(put?.body))).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ kind: 'format', key: 'workshop', label: 'Deep dive' }),
      ]),
    })
  })

  it('surfaces a CSRF-forbidden 403 as a uniform forbidden state with no detail', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountTaxonomy()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Deep dive')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.textContent?.toLowerCase()).not.toMatch(/csrf|origin/i)
    // The save region stays mounted and silent — a refused save must not leave
    // anything claiming the taxonomies were stored.
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('redirects to /admin when the session expires during save', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { router } = await mountTaxonomy()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Deep dive')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin')
    })
    expect(screen.getByTestId('login-redirect')).toBeInTheDocument()
  })

  it('rejects a duplicate (kind, key) client-side with no PUT write', async () => {
    const user = userEvent.setup()
    await mountTaxonomy()

    const keys = await screen.findAllByLabelText('Key')
    await user.clear(keys[1]!)
    await user.type(keys[1]!, 'workshop')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        return (
          requestUrl(input) === '/api/admin/events/demo-conf-2026/taxonomies' &&
          (init?.method ?? 'GET') === 'PUT'
        )
      }),
    ).toBe(false)
  })

  it('renders a distinct forbidden state on a 403 load', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountTaxonomy()

    expect(await screen.findByText('Access forbidden')).toBeInTheDocument()
    expect(screen.getByText('You do not have permission to view this page.')).toBeInTheDocument()
    expect(screen.queryByText('This page could not be found.')).not.toBeInTheDocument()
  })

  it('renders a distinct denied state on a 404 load', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountTaxonomy()

    expect(await screen.findByText('Not found')).toBeInTheDocument()
    expect(screen.getByText('This page could not be found.')).toBeInTheDocument()
    expect(
      screen.queryByText('You do not have permission to view this page.'),
    ).not.toBeInTheDocument()
  })

  it('shows Saving… and keeps Save disabled while the mutation is pending, then re-enables', async () => {
    const user = userEvent.setup()
    let resolveSave: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === '/api/admin/events/demo-conf-2026/taxonomies') {
        return new Promise<Response>((resolve) => {
          resolveSave = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountTaxonomy()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Deep dive')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const saveButton = screen.getByRole('button', { name: /saving/i })
    expect(saveButton).toHaveTextContent('Saving…')
    expect(saveButton).toBeDisabled()

    resolveSave?.(jsonResponse(TAXONOMY_DTO))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
  })

  it('prevents beforeunload while the form is dirty', async () => {
    const user = userEvent.setup()
    await mountTaxonomy()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Deep dive')

    expect(dispatchBeforeUnload().defaultPrevented).toBe(true)
  })

  it('does not prevent beforeunload after a successful save rebases the form', async () => {
    const user = userEvent.setup()
    await mountTaxonomy()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Deep dive')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false)
  })
})
