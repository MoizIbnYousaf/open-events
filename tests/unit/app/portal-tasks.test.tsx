import '@testing-library/jest-dom/vitest'
import type { ReactElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
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
  speakerTaskLabel,
} from '../../../src/app/queries/portal-tasks'
import { Route as ReadinessRoute } from '../../../src/app/routes/admin_.events.$slug_.readiness'

// REQ-011/012 surfaces, pinned to the SHAPES THE SERVER ACTUALLY SENDS.
// GET /api/public/tasks answers a bare SpeakerTaskDto[] (no envelope) whose
// rows carry `kind` + `submissionTitle` and a 'pending' | 'completed' status;
// POST /api/public/tasks/:id/complete answers the bare updated DTO; and GET
// /api/admin/readiness?eventSlug= answers an EventReadinessDto aggregate whose
// per-submission rows are `submissions`, never `rows`. The human task label is
// client copy derived from `kind` because the wire carries no title, and the
// readiness table renders only fields the server produces (no speaker email).

const TASKS_URL = '/api/public/tasks'
const EVENT_SLUG = 'demo-conf-2026'
const OTHER_EVENT_SLUG = 'other-conf-2026'
const READINESS_PATH = '/api/admin/readiness'
const READINESS_URL = `${READINESS_PATH}?eventSlug=${EVENT_SLUG}`
const OTHER_READINESS_URL = `${READINESS_PATH}?eventSlug=${OTHER_EVENT_SLUG}`
const COMPLETE_URL = '/api/public/tasks/task-1/complete'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'

const HEADSHOT_LABEL = 'Upload your headshot'
const CONFIRM_LABEL = 'Confirm your participation'

/** Exactly the body src/server/routes/public.ts:223 emits (bare array). */
const TASKS = [
  {
    id: 'task-1',
    eventId: EVENT_ID,
    submissionId: 'submission-1',
    submissionTitle: 'My talk',
    contactId: 'contact-1',
    kind: 'submit_headshot',
    status: 'pending',
    position: 2,
    createdAt: '2026-05-01T08:00:00.000Z',
    completedAt: null,
  },
  {
    id: 'task-2',
    eventId: EVENT_ID,
    submissionId: 'submission-1',
    submissionTitle: 'My talk',
    contactId: 'contact-1',
    kind: 'confirm_participation',
    status: 'completed',
    position: 0,
    createdAt: '2026-05-01T08:00:00.000Z',
    completedAt: '2026-05-01T09:00:00.000Z',
  },
] as const

const COMPLETED_TASK = { ...TASKS[0], status: 'completed', completedAt: '2026-05-02T09:00:00.000Z' }

/** Exactly the body src/server/routes/admin.ts:353 emits (EventReadinessDto). */
const READINESS = {
  eventId: EVENT_ID,
  acceptedSubmissions: 2,
  totalTasks: 6,
  completedTasks: 4,
  percentComplete: 67,
  submissions: [
    {
      submissionId: 'submission-1',
      title: 'My talk',
      totalTasks: 3,
      completedTasks: 1,
      percentComplete: 33,
      ready: false,
    },
    {
      submissionId: 'submission-2',
      title: 'Hands-on workshop',
      totalTasks: 3,
      completedTasks: 3,
      percentComplete: 100,
      ready: true,
    },
  ],
} as const

const EMPTY_READINESS = {
  ...READINESS,
  acceptedSubmissions: 0,
  totalTasks: 0,
  completedTasks: 0,
  percentComplete: 100,
  submissions: [],
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

/**
 * Readiness inside a router, because its rows now drill down.
 *
 * Every identity cell on this table is a `Link` to the submission it names, so
 * the page needs a router the way the submissions list beside it always has.
 * The stub destination is registered as a real route: a link that resolves to
 * nothing is not the contract, and asserting on its `href` is how the test
 * proves the row leads where it says it does.
 */
async function renderReadiness(eventSlug: string) {
  const rootRoute = createRootRoute()
  const readinessRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/readiness',
    component: () => <ReadinessPage eventSlug={eventSlug} />,
  })
  const submissionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions/$submissionId',
    component: () => <div>Submission</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([readinessRoute, submissionRoute]),
    history: createMemoryHistory({ initialEntries: [`/admin/events/${eventSlug}/readiness`] }),
  })
  // Loaded before it is rendered: a RouterProvider that has not resolved its
  // match yet paints nothing, and the first assertion after `render` — the
  // loading state's own aria-busy — would be reading an empty document.
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
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
    if (method === 'GET' && url === OTHER_READINESS_URL) return jsonResponse(EMPTY_READINESS)
    if (method === 'POST' && url === COMPLETE_URL) return jsonResponse(COMPLETED_TASK)
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

  it('labels every checklist kind the domain can emit', () => {
    expect(speakerTaskLabel('confirm_participation')).toBe(CONFIRM_LABEL)
    expect(speakerTaskLabel('submit_bio')).toBe('Submit your speaker bio')
    expect(speakerTaskLabel('submit_headshot')).toBe(HEADSHOT_LABEL)
  })

  it('getPortalTasks reads the bare array the server sends', async () => {
    await expect(getPortalTasks()).resolves.toEqual([
      {
        id: 'task-1',
        kind: 'submit_headshot',
        submissionTitle: 'My talk',
        status: 'pending',
        completedAt: null,
      },
      {
        id: 'task-2',
        kind: 'confirm_participation',
        submissionTitle: 'My talk',
        status: 'completed',
        completedAt: '2026-05-01T09:00:00.000Z',
      },
    ])
    expect(countCalls(TASKS_URL)).toBe(1)
  })

  it('propagates the 401 unauthenticated seam without raw server copy', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'unauthenticated', message: 'raw server copy' } }, 401)
    await expect(getPortalTasks()).rejects.toMatchObject({ status: 401 })
  })

  it('completePortalTask POSTs the exact URL and reads the bare updated task', async () => {
    await expect(completePortalTask('task-1')).resolves.toEqual({
      id: 'task-1',
      kind: 'submit_headshot',
      submissionTitle: 'My talk',
      status: 'completed',
      completedAt: '2026-05-02T09:00:00.000Z',
    })
    expect(countCalls(COMPLETE_URL, 'POST')).toBe(1)
  })

  it('getOrganizerReadiness reads the aggregate submissions the server sends', async () => {
    await expect(getOrganizerReadiness(EVENT_SLUG)).resolves.toEqual([
      {
        submissionId: 'submission-1',
        title: 'My talk',
        totalTasks: 3,
        completedTasks: 1,
        outstandingCount: 2,
        percentComplete: 33,
        ready: false,
      },
      {
        submissionId: 'submission-2',
        title: 'Hands-on workshop',
        totalTasks: 3,
        completedTasks: 3,
        outstandingCount: 0,
        percentComplete: 100,
        ready: true,
      },
    ])
    expect(countCalls(READINESS_URL)).toBe(1)
  })

  it('keeps every readiness request on the pinned path, scoped by eventSlug', async () => {
    await getOrganizerReadiness(EVENT_SLUG)
    const readinessCalls = fetchMock.mock.calls
      .map((call) => requestUrl((call as [RequestInfo | URL, RequestInit | undefined])[0]))
      .filter((url) => url.includes('readiness'))
    expect(readinessCalls.length).toBeGreaterThan(0)
    for (const url of readinessCalls) {
      const parsed = new URL(url, 'https://open-events.test')
      expect(parsed.pathname).toBe(READINESS_PATH)
      expect(parsed.searchParams.get('eventSlug')).toBe(EVENT_SLUG)
    }
  })

  it('percent-encodes the event scope so a slug can never escape the query', async () => {
    fetchHandler = () => jsonResponse(EMPTY_READINESS)
    await getOrganizerReadiness('a&b c')
    const [input] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined]
    const parsed = new URL(requestUrl(input), 'https://open-events.test')
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
    expect(await screen.findByText(HEADSHOT_LABEL)).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('renders an accessible list marking complete tasks by text, not color alone', async () => {
    renderWithClient(<TasksPanel />)

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(HEADSHOT_LABEL)
    expect(items[0]).toHaveTextContent('My talk')
    expect(items[0]).toHaveTextContent('Outstanding')
    expect(items[1]).toHaveTextContent(CONFIRM_LABEL)
    expect(items[1]).toHaveTextContent('Complete')
    expect(
      screen.queryByRole('button', { name: `Mark complete: ${CONFIRM_LABEL} for My talk` }),
    ).not.toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('undefined')
  })

  it('renders a real empty state when there are no tasks', async () => {
    fetchHandler = () => jsonResponse([])
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

    expect(await screen.findByText(HEADSHOT_LABEL)).toBeInTheDocument()
  })

  it('optimistically marks a task complete and keeps it complete after the refetch', async () => {
    let resolveComplete: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === TASKS_URL) {
        return jsonResponse(countCalls(TASKS_URL) > 1 ? [COMPLETED_TASK, TASKS[1]] : TASKS)
      }
      if (method === 'POST' && url === COMPLETE_URL) {
        return new Promise<Response>((resolve) => {
          resolveComplete = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderWithClient(<TasksPanel />)

    await screen.findByText(HEADSHOT_LABEL)
    await userEvent.click(
      screen.getByRole('button', { name: `Mark complete: ${HEADSHOT_LABEL} for My talk` }),
    )

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Complete')
    })
    expect(countCalls(TASKS_URL)).toBe(1)

    resolveComplete?.(jsonResponse(COMPLETED_TASK))

    await waitFor(() => {
      expect(countCalls(TASKS_URL)).toBe(2)
    })
    // The server's own vocabulary must survive the refetch: no revert to
    // "Outstanding" and no reappearing completion button.
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Complete')
    })
    expect(
      screen.queryByRole('button', { name: `Mark complete: ${HEADSHOT_LABEL} for My talk` }),
    ).not.toBeInTheDocument()
  })

  it('rolls the optimistic flip back and alerts when completing fails', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === TASKS_URL) return jsonResponse(TASKS)
      return jsonResponse({ error: { code: 'internal', message: 'raw server copy' } }, 500)
    }
    renderWithClient(<TasksPanel />)

    await screen.findByText(HEADSHOT_LABEL)
    await userEvent.click(
      screen.getByRole('button', { name: `Mark complete: ${HEADSHOT_LABEL} for My talk` }),
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
    await renderReadiness(EVENT_SLUG)

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
    expect(rendered).toContain('Hands-on workshop')
    expect(screen.getByText('2 outstanding')).toBeInTheDocument()
    expect(screen.getByText('0 outstanding')).toBeInTheDocument()
    expect(screen.getByText('1 complete')).toBeInTheDocument()
    expect(screen.getByText('3 complete')).toBeInTheDocument()
    expect(rendered).not.toContain('undefined')
  })

  it('makes every identity cell a drill-down to that submission', async () => {
    await renderReadiness(EVENT_SLUG)

    // TA2-1.2: a row that names a proposal and reports what its speaker still
    // owes must also be the way to that proposal. It used to be inert text, so
    // an organizer read "not ready" here and then went hunting for the same
    // title on another list.
    const talk = await screen.findByRole('link', { name: 'My talk — open submission' })
    expect(talk).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/submissions/${READINESS.submissions[0].submissionId}`,
    )
    const workshop = screen.getByRole('link', { name: 'Hands-on workshop — open submission' })
    expect(workshop).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/submissions/${READINESS.submissions[1].submissionId}`,
    )
    // One link per row, in the identity cell and nowhere else: the count of
    // ways out of a row is part of what keeps the table scannable.
    expect(screen.getAllByRole('link')).toHaveLength(2)
    // WCAG 2.2 target size, the same opt-in the submissions list uses for the
    // same reason — a link alone in a table cell.
    expect(talk).toHaveClass('inline-flex', 'min-h-6', 'min-w-6')
  })

  // TA4-P3: the frame belongs to the element that scrolls. Wrapped in an
  // `overflow-hidden` box, the scroll container's focus ring — an outward
  // shadow on a real tab stop — was clipped out of existence.
  it('frames the scroller itself, so nothing clips its focus ring', async () => {
    await renderReadiness(EVENT_SLUG)
    await screen.findByRole('table')

    const scroller = document.querySelector('[data-slot="table-container"]')
    expect(scroller).toHaveClass('ring-1', 'ring-border', 'rounded-lg')
    expect(scroller).toHaveClass('focus-visible:ring-2')
    expect(scroller).toHaveAttribute('tabindex', '0')
    expect(scroller?.parentElement?.className ?? '').not.toContain('overflow-hidden')
  })

  // TA5-P1: ready/not ready is a lifecycle state, so it says so in shape as
  // well as in tint — a channel that survives greyscale and colour blindness.
  it('marks the readiness chips as state, in both the row and the header', async () => {
    await renderReadiness(EVENT_SLUG)
    await screen.findByRole('table')

    const chips = Array.from(document.querySelectorAll('[data-slot="badge"]'))
    expect(chips.map((chip) => chip.textContent)).toEqual(['1 not ready', 'Not ready', 'Ready'])
    for (const chip of chips) {
      expect(chip).toHaveAttribute('data-dot', '')
      // Nothing is in flight on a page that only reads.
      expect(chip).not.toHaveAttribute('data-pending')
    }
  })

  it('shows an aria-busy loading status, an empty state, and an error retry', async () => {
    let resolveRows: ((response: Response) => void) | undefined
    fetchHandler = () =>
      new Promise<Response>((resolve) => {
        resolveRows = resolve
      })
    const first = await renderReadiness(EVENT_SLUG)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
    resolveRows?.(jsonResponse(EMPTY_READINESS))
    expect(await screen.findByText('No submissions to track yet.')).toBeInTheDocument()
    first.queryClient.clear()
    cleanup()

    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'raw server copy' } }, 500)
    await renderReadiness(EVENT_SLUG)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load readiness.')
    expect(document.body.textContent ?? '').not.toContain('raw server copy')

    fetchHandler = () => jsonResponse(READINESS)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('My talk')).toBeInTheDocument()
  })

  it('reads only the routed event dataset, never another event’s rows', async () => {
    await renderReadiness(OTHER_EVENT_SLUG)

    expect(await screen.findByText('No submissions to track yet.')).toBeInTheDocument()
    expect(countCalls(OTHER_READINESS_URL)).toBe(1)
    expect(countCalls(READINESS_URL)).toBe(0)
    expect(document.body.textContent ?? '').not.toContain('My talk')
  })

  it('refreshes readiness on the pinned bounded polling interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await renderReadiness(EVENT_SLUG)
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

describe('speaker task control naming', () => {
  it('leads the confirm-participation name with the words on the button', async () => {
    fetchHandler = (url) =>
      url === TASKS_URL
        ? jsonResponse([{ ...TASKS[1], status: 'pending', completedAt: null }])
        : jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    renderWithClient(<TasksPanel />)

    const control = await screen.findByRole('button', { name: /^I confirm I will participate/ })
    expect(control).toHaveTextContent('I confirm I will participate')
    // WCAG 2.5.3: the visible words start the accessible name; the row context
    // that keeps three sibling rows apart follows it.
    expect(control.getAttribute('aria-label')).toContain('I confirm I will participate')
    expect(control.getAttribute('aria-label')).toContain(
      'Mark complete: Confirm your participation for My talk',
    )
  })
})
