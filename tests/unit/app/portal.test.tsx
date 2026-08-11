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
//
// The persisted submission status is pinned to 'pending' by migration 0002 and
// acceptance is its own record, so the acceptance state travels as the
// `accepted` flag on the own-submissions payload — the ONLY status vocabulary
// the API can produce. An accepted submission also exposes its calendar invite.

const PORTAL_URL = '/api/public/submissions'

const SUBMISSIONS_ENVELOPE = {
  submissions: [
    {
      id: 'submission-1',
      title: 'Deterministic conflict detection at scale',
      status: 'pending',
      accepted: false,
      inviteAvailable: false,
      formSlug: 'cfp',
      version: 1,
      coSpeakerCount: 1,
      submittedAt: '2026-05-01T09:00:00.000Z',
    },
    {
      id: 'submission-2',
      title: 'Base UI in production',
      status: 'pending',
      accepted: true,
      inviteAvailable: true,
      formSlug: 'cfp',
      version: 1,
      coSpeakerCount: 0,
      submittedAt: '2026-04-20T10:00:00.000Z',
    },
  ],
} as const

/** Accepted, but the organizer has cleared the event dates: no .ics exists. */
const UNDATED_ENVELOPE = {
  submissions: [{ ...SUBMISSIONS_ENVELOPE.submissions[1], inviteAvailable: false }],
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
    expect(items[0]).toHaveTextContent(/pending review/i)
    expect(items[0]).not.toHaveTextContent(/accepted/i)
    expect(items[1]).toHaveTextContent('Base UI in production')
    expect(items[1]).toHaveTextContent(/accepted/i)
  })

  it('marks each submission chip as a lifecycle state, in both faces', async () => {
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
    // Where a proposal stands IS a lifecycle state, so both faces carry the
    // marker — the non-colour channel that separates a state from a plain
    // value once the product has spent its colour on one accent. The quieter
    // of the two is still a state, so it keeps the marker too.
    const pendingChip = items[0]?.querySelector('[data-slot="badge"]')
    const acceptedChip = items[1]?.querySelector('[data-slot="badge"]')
    expect(pendingChip).toHaveAttribute('data-dot', '')
    expect(acceptedChip).toHaveAttribute('data-dot', '')
    // The label is the state itself and the marker never replaces it: colour
    // and shape are both second channels, never the only one.
    expect(pendingChip).toHaveTextContent(/pending review/i)
    expect(acceptedChip).toHaveTextContent(/accepted/i)
  })

  it('offers the calendar invite only for an accepted submission', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PORTAL_URL) {
        return jsonResponse(SUBMISSIONS_ENVELOPE)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage()
    const list = await screen.findByRole('list', { name: /your submissions/i })
    const links = within(list).getAllByRole('link', { name: /calendar invite/i })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/api/public/invite/submission-2.ics')
  })

  // The invite route answers 409 JSON when the event has no dates, and a
  // `download` anchor would save that error body as the .ics file. The link
  // must not exist unless the server says an invite can be built.
  it('never offers a download the invite route cannot serve', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PORTAL_URL) {
        return jsonResponse(UNDATED_ENVELOPE)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage()
    const list = await screen.findByRole('list', { name: /your submissions/i })
    expect(within(list).queryByRole('link', { name: /calendar invite/i })).toBeNull()
    expect(within(list).getByText(/event dates/i)).toBeInTheDocument()
  })

  it('keeps exactly one page-owned h1 on the composed portal', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PORTAL_URL) {
        return jsonResponse(SUBMISSIONS_ENVELOPE)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage()
    await screen.findByRole('list', { name: /your submissions/i })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
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
