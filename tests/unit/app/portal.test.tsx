import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getOwnSubmissions,
  portalQueryKeys,
  useOwnSubmissions,
} from '../../../src/app/queries/portal'
import PortalPage from '../../../src/app/features/public/PortalPage'
import {
  Route as PortalRoute,
  PortalPage as PortalRoutePage,
} from '../../../src/app/routes/_public/portal'

// Speaker portal contract: GET /api/public/submissions returns the signed-in
// speaker's own submissions as a { submissions } envelope. The page owns its
// h1 per state, exposes loading status, keeps fetches exact, sanitizes error
// states, redirects unauthenticated visitors toward /start via the provided
// callback, and renders one accessible row per submission with its title and
// current status. No dead controls, no invented data.

const PORTAL_URL = '/api/public/submissions'

const SUBMISSIONS_ENVELOPE = {
  submissions: [
    {
      id: 'submission-1',
      title: 'Deterministic conflict detection at scale',
      status: 'submitted',
      formSlug: 'cfp',
      version: 1,
      coSpeakerCount: 1,
      submittedAt: '2026-05-01T09:00:00.000Z',
    },
    {
      id: 'submission-2',
      title: 'Base UI in production',
      status: 'accepted',
      formSlug: 'cfp',
      version: 1,
      coSpeakerCount: 0,
      submittedAt: '2026-04-20T10:00:00.000Z',
    },
  ],
} as const

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>

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
  fetchHandler = () =>
    jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(fetchHandler(requestUrl(input), init)),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderPage(onUnauthenticated = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <PortalPage onUnauthenticated={onUnauthenticated} />
    </QueryClientProvider>,
  )
  return { queryClient, onUnauthenticated }
}

describe('speaker portal', () => {
  it('registers the portal route with the production page', () => {
    expect(PortalRoute.options.path).toBe('/portal')
    expect(PortalRoute.options.component).toBe(PortalRoutePage)
  })

  it('getOwnSubmissions GETs the exact URL, maps 401 to null, and propagates other errors', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PORTAL_URL) {
        return jsonResponse(SUBMISSIONS_ENVELOPE)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await expect(getOwnSubmissions()).resolves.toEqual(SUBMISSIONS_ENVELOPE.submissions)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchHandler = () => jsonResponse({ error: { code: 'unauthorized', message: 'raw copy' } }, 401)
    await expect(getOwnSubmissions()).resolves.toBeNull()

    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
    await expect(getOwnSubmissions()).rejects.toThrow(/unavailable|failed/i)
    await expect(getOwnSubmissions()).rejects.not.toThrow(/boom raw server copy/)
  })

  it('uses the literal portal query key for useOwnSubmissions', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PORTAL_URL) {
        return jsonResponse(SUBMISSIONS_ENVELOPE)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    function Probe() {
      const query = useOwnSubmissions()
      return <div>{query.isSuccess ? 'loaded' : 'pending'}</div>
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    )
    await screen.findByText('loaded')
    expect(portalQueryKeys.ownSubmissions()).toEqual(['portal', 'own-submissions'])
    expect(queryClient.getQueryState(['portal', 'own-submissions'])?.status).toBe('success')
  })

  it('keeps the loading state heading-owned with a polite status, cleared after ready', async () => {
    fetchHandler = () => new Promise<Response>(() => undefined)
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: /your submissions/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
  })

  it('invokes onUnauthenticated (start redirect seam) when the session is missing', async () => {
    fetchHandler = () => jsonResponse({ error: { code: 'unauthorized', message: 'raw copy' } }, 401)
    const { onUnauthenticated } = renderPage()
    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledTimes(1))
  })

  it('renders a real empty state without dead controls', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PORTAL_URL) {
        return jsonResponse({ submissions: [] })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage()
    expect(await screen.findByText(/no submissions yet/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: /your submissions/i })).toBeInTheDocument()
  })

  it('renders one accessible row per submission with title and current status', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PORTAL_URL) {
        return jsonResponse(SUBMISSIONS_ENVELOPE)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage()
    const list = await screen.findByRole('list', { name: /your submissions/i })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Deterministic conflict detection at scale')
    expect(items[0]).toHaveTextContent(/submitted/i)
    expect(items[1]).toHaveTextContent('Base UI in production')
    expect(items[1]).toHaveTextContent(/accepted/i)
  })

  it('shows generic error copy with a working retry and no raw server leakage', async () => {
    let calls = 0
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PORTAL_URL) {
        calls += 1
        if (calls === 1) {
          return jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
        }
        return jsonResponse(SUBMISSIONS_ENVELOPE)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(/boom raw server copy/)
    const retry = screen.getByRole('button', { name: /try again/i })
    await userEvent.click(retry)
    expect(await screen.findByRole('list', { name: /your submissions/i })).toBeInTheDocument()
  })
})
