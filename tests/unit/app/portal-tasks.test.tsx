import '@testing-library/jest-dom/vitest'
import type { ReactElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TasksPanel from '../../../src/app/features/public/TasksPanel'
import ReadinessPage from '../../../src/app/features/admin/ReadinessPage'
import {
  READINESS_POLL_INTERVAL_MS,
  completePortalTask,
  getOrganizerReadiness,
  getPortalTasks,
  organizerReadinessQueryOptions,
  portalTaskQueryKeys,
} from '../../../src/app/queries/portal-tasks'
import { Route as ReadinessRoute } from '../../../src/app/routes/admin_.events.$slug_.readiness'

// REQ-011/012 surfaces. Speaker task panel: GET /api/public/tasks returns
// { tasks: [...] }, 401 is the unauthenticated seam, and completing a task
// POSTs /api/public/tasks/:id/complete with an optimistic flip plus
// invalidation. Organizer readiness uses the pinned cross-slice contract GET
// /api/admin/readiness -> { rows: [...] }, scoped to the routed event with an
// eventSlug query parameter so the surface can only ever read the routed
// event's rows. The rows render as a real table refreshed by bounded polling.

const TASKS_URL = '/api/public/tasks'
const EVENT_SLUG = 'demo-conf-2026'
const OTHER_EVENT_SLUG = 'other-conf-2026'
const READINESS_PATH = '/api/admin/readiness'
const READINESS_URL = `${READINESS_PATH}?eventSlug=${EVENT_SLUG}`
const OTHER_READINESS_URL = `${READINESS_PATH}?eventSlug=${OTHER_EVENT_SLUG}`
const COMPLETE_URL = '/api/public/tasks/task-1/complete'

const TASKS = {
  tasks: [
    { id: 'task-1', title: 'Upload your headshot', status: 'pending', completedAt: null },
    {
      id: 'task-2',
      title: 'Confirm your travel dates',
      status: 'complete',
      completedAt: '2026-05-01T09:00:00.000Z',
    },
  ],
} as const

const READINESS = {
  rows: [
    {
      submissionId: 'submission-1',
      title: 'My talk',
      speakerEmail: 'speaker.a@example.test',
      outstandingCount: 2,
      completeCount: 1,
    },
    {
      submissionId: 'submission-2',
      title: 'Hands-on workshop',
      speakerEmail: 'speaker.b@example.test',
      outstandingCount: 0,
      completeCount: 3,
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

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  return { queryClient }
}

function countCalls(url: string, method = 'GET'): number {
  return fetchMock.mock.calls.filter((call) => {
    const [input, init] = call as [RequestInfo | URL, RequestInit | undefined]
    return requestUrl(input) === url && (init?.method ?? 'GET') === method
  }).length
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === TASKS_URL) return jsonResponse(TASKS)
    if (method === 'GET' && url === READINESS_URL) return jsonResponse(READINESS)
    if (method === 'GET' && url === OTHER_READINESS_URL) return jsonResponse({ rows: [] })
    if (method === 'POST' && url === COMPLETE_URL) {
      return jsonResponse({
        task: {
          id: 'task-1',
          title: 'Upload your headshot',
          status: 'complete',
          completedAt: '2026-05-02T09:00:00.000Z',
        },
      })
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    fetchHandler(requestUrl(input), init),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('portal task queries', () => {
  it('pins the literal query keys', () => {
    expect(portalTaskQueryKeys.tasks()).toEqual(['portal', 'tasks'])
    expect(portalTaskQueryKeys.readiness(EVENT_SLUG)).toEqual([
      'admin',
      'events',
      EVENT_SLUG,
      'readiness',
    ])
  })

  it('getPortalTasks GETs the exact URL and returns the task list', async () => {
    await expect(getPortalTasks()).resolves.toEqual(TASKS.tasks)
    expect(countCalls(TASKS_URL)).toBe(1)
  })

  it('propagates the 401 unauthenticated seam without raw server copy', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'unauthenticated', message: 'raw server copy' } }, 401)
    await expect(getPortalTasks()).rejects.toMatchObject({ status: 401 })
  })

  it('completePortalTask POSTs the exact complete URL and returns the task', async () => {
    await expect(completePortalTask('task-1')).resolves.toMatchObject({
      id: 'task-1',
      status: 'complete',
    })
    expect(countCalls(COMPLETE_URL, 'POST')).toBe(1)
  })

  it('getOrganizerReadiness GETs the pinned readiness path and returns the rows', async () => {
    await expect(getOrganizerReadiness(EVENT_SLUG)).resolves.toEqual(READINESS.rows)
    expect(countCalls(READINESS_URL)).toBe(1)
  })

  it('keeps every readiness request on the pinned path, scoped by eventSlug', async () => {
    await getOrganizerReadiness(EVENT_SLUG)
    const readinessCalls = fetchMock.mock.calls
      .map((call) => requestUrl((call as [RequestInfo | URL, RequestInit | undefined])[0]))
      .filter((url) => url.includes('readiness'))
    expect(readinessCalls.length).toBeGreaterThan(0)
    for (const url of readinessCalls) {
      const parsed = new URL(url, 'https://speakerops.test')
      expect(parsed.pathname).toBe(READINESS_PATH)
      expect(parsed.searchParams.get('eventSlug')).toBe(EVENT_SLUG)
    }
  })

  it('percent-encodes the event scope so a slug can never escape the query', async () => {
    fetchHandler = () => jsonResponse({ rows: [] })
    await getOrganizerReadiness('a&b c')
    const [input] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined]
    const parsed = new URL(requestUrl(input), 'https://speakerops.test')
    expect(parsed.pathname).toBe(READINESS_PATH)
    expect(parsed.searchParams.get('eventSlug')).toBe('a&b c')
  })

  it('pins bounded readiness polling to a fixed interval per event', () => {
    expect(READINESS_POLL_INTERVAL_MS).toBe(30_000)
    const options = organizerReadinessQueryOptions(EVENT_SLUG)
    expect(options.queryKey).toEqual(['admin', 'events', EVENT_SLUG, 'readiness'])
    expect(options.refetchInterval).toBe(30_000)
    expect(options.enabled).toBe(true)
    expect(organizerReadinessQueryOptions('').enabled).toBe(false)
  })
})

describe('speaker tasks panel', () => {
  it('shows an aria-busy status while loading, then the task list', async () => {
    let resolveTasks: ((response: Response) => void) | undefined
    fetchHandler = () =>
      new Promise<Response>((resolve) => {
        resolveTasks = resolve
      })
    renderWithClient(<TasksPanel />)

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()

    resolveTasks?.(jsonResponse(TASKS))
    expect(await screen.findByText('Upload your headshot')).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('renders an accessible list marking complete tasks by text, not color alone', async () => {
    renderWithClient(<TasksPanel />)

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Upload your headshot')
    expect(items[0]).toHaveTextContent('Outstanding')
    expect(items[1]).toHaveTextContent('Confirm your travel dates')
    expect(items[1]).toHaveTextContent('Complete')
    expect(
      screen.queryByRole('button', { name: 'Mark complete: Confirm your travel dates' }),
    ).not.toBeInTheDocument()
  })

  it('renders a real empty state when there are no tasks', async () => {
    fetchHandler = () => jsonResponse({ tasks: [] })
    renderWithClient(<TasksPanel />)

    expect(await screen.findByText('No tasks yet.')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('shows the unauthenticated seam on 401 without a retry control', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'unauthenticated', message: 'raw server copy' } }, 401)
    renderWithClient(<TasksPanel />)

    expect(await screen.findByText('Sign in to view your tasks.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('raw server copy')
  })

  it('shows a generic error alert with a working Try again retry', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'raw server copy' } }, 500)
    renderWithClient(<TasksPanel />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load your tasks.')
    expect(document.body.textContent ?? '').not.toContain('raw server copy')

    fetchHandler = () => jsonResponse(TASKS)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Upload your headshot')).toBeInTheDocument()
  })

  it('optimistically marks a task complete before the response settles', async () => {
    let resolveComplete: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === TASKS_URL) return jsonResponse(TASKS)
      if (method === 'POST' && url === COMPLETE_URL) {
        return new Promise<Response>((resolve) => {
          resolveComplete = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderWithClient(<TasksPanel />)

    await screen.findByText('Upload your headshot')
    await userEvent.click(
      screen.getByRole('button', { name: 'Mark complete: Upload your headshot' }),
    )

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Complete')
    })
    expect(countCalls(TASKS_URL)).toBe(1)

    resolveComplete?.(
      jsonResponse({
        task: {
          id: 'task-1',
          title: 'Upload your headshot',
          status: 'complete',
          completedAt: '2026-05-02T09:00:00.000Z',
        },
      }),
    )

    await waitFor(() => {
      expect(countCalls(TASKS_URL)).toBe(2)
    })
  })

  it('rolls the optimistic flip back and alerts when completing fails', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === TASKS_URL) return jsonResponse(TASKS)
      return jsonResponse({ error: { code: 'internal', message: 'raw server copy' } }, 500)
    }
    renderWithClient(<TasksPanel />)

    await screen.findByText('Upload your headshot')
    await userEvent.click(
      screen.getByRole('button', { name: 'Mark complete: Upload your headshot' }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to complete that task.')
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Outstanding')
    })
    expect(document.body.textContent ?? '').not.toContain('raw server copy')
  })
})

describe('organizer readiness', () => {
  it('registers the readiness route with the production page', () => {
    expect(ReadinessRoute.options.path).toBe('/admin/events/$slug/readiness')
    expect(ReadinessRoute.options.component).toBeTypeOf('function')
  })

  it('renders exactly one page-owned h1 and a real readiness table', async () => {
    renderWithClient(<ReadinessPage eventSlug={EVENT_SLUG} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Readiness' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header).toHaveAttribute('scope', 'col')
    }
    expect(screen.getAllByRole('row')).toHaveLength(3)
    const rendered = document.body.textContent ?? ''
    expect(rendered).toContain('My talk')
    expect(rendered).toContain('speaker.b@example.test')
    expect(screen.getByText('2 outstanding')).toBeInTheDocument()
    expect(screen.getByText('0 outstanding')).toBeInTheDocument()
  })

  it('shows an aria-busy loading status, an empty state, and an error retry', async () => {
    let resolveRows: ((response: Response) => void) | undefined
    fetchHandler = () =>
      new Promise<Response>((resolve) => {
        resolveRows = resolve
      })
    const first = renderWithClient(<ReadinessPage eventSlug={EVENT_SLUG} />)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
    resolveRows?.(jsonResponse({ rows: [] }))
    expect(await screen.findByText('No submissions to track yet.')).toBeInTheDocument()
    first.queryClient.clear()
    cleanup()

    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'raw server copy' } }, 500)
    renderWithClient(<ReadinessPage eventSlug={EVENT_SLUG} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load readiness.')
    expect(document.body.textContent ?? '').not.toContain('raw server copy')

    fetchHandler = () => jsonResponse(READINESS)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('My talk')).toBeInTheDocument()
  })

  it('reads only the routed event dataset, never another event\u2019s rows', async () => {
    renderWithClient(<ReadinessPage eventSlug={OTHER_EVENT_SLUG} />)

    expect(await screen.findByText('No submissions to track yet.')).toBeInTheDocument()
    expect(countCalls(OTHER_READINESS_URL)).toBe(1)
    expect(countCalls(READINESS_URL)).toBe(0)
    expect(document.body.textContent ?? '').not.toContain('speaker.a@example.test')
  })

  it('refreshes readiness on the pinned bounded polling interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderWithClient(<ReadinessPage eventSlug={EVENT_SLUG} />)
      await vi.waitFor(() => {
        expect(countCalls(READINESS_URL)).toBe(1)
      })
      await vi.advanceTimersByTimeAsync(READINESS_POLL_INTERVAL_MS + 100)
      await vi.waitFor(() => {
        expect(countCalls(READINESS_URL)).toBe(2)
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
