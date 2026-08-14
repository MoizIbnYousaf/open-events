import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  announce,
  clearAnnouncements,
  getAnnouncementSnapshot,
  subscribeToAnnouncements,
} from '../../../src/app/lib/announcer'
import { LiveAnnouncer } from '../../../src/components/ui/live-announcer'
import { createQueryClient } from '../../../src/app/query-client'
import AdminLogin from '../../../src/app/features/admin/AdminLogin'
import CommunicationsPanel from '../../../src/app/features/admin/CommunicationsPanel'
import EvaluationsPage from '../../../src/app/features/public/EvaluationsPage'
import TasksPanel from '../../../src/app/features/public/TasksPanel'

const SUBMISSION_ID = 'b1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'

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

function unexpected(): Response {
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

function callsTo(url: string, method: string): unknown[] {
  return fetchMock.mock.calls.filter(([input, init]) => {
    return (
      requestUrl(input as RequestInfo | URL) === url &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === method
    )
  })
}

/** Holds a request in flight so a pending state can be observed. */
function neverSettles(): Promise<Response> {
  return new Promise<Response>(() => undefined)
}

beforeEach(() => {
  clearAnnouncements()
  fetchHandler = () => unexpected()
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAnnouncements()
  cleanup()
})

describe('app announcer', () => {
  it('mounts both regions from first paint, empty and always present', () => {
    const { container } = render(<LiveAnnouncer />)

    const polite = container.querySelector('[aria-live="polite"]')
    const assertive = container.querySelector('[aria-live="assertive"]')
    expect(polite).not.toBeNull()
    expect(assertive).not.toBeNull()
    expect(polite).toHaveAttribute('aria-atomic', 'true')
    expect(polite?.textContent).toBe('')
  })

  it('does not add a second role=status/role=alert to the page', () => {
    render(<LiveAnnouncer />)
    announce('Event settings saved')

    // 90+ singular getByRole('status') assertions exist across the suite; the
    // announcer must never be one of them.
    expect(screen.queryAllByRole('status')).toHaveLength(0)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('announces an identical repeat message twice', async () => {
    const { container } = render(<LiveAnnouncer />)
    const polite = container.querySelector('[aria-live="polite"]') as HTMLElement

    announce('Event settings saved')
    await waitFor(() => expect(polite.textContent).toBe('Event settings saved'))
    const firstNode = polite.firstElementChild

    announce('Event settings saved')
    await waitFor(() => expect(polite.firstElementChild).not.toBe(firstNode))
    expect(polite.textContent).toBe('Event settings saved')
  })

  it('routes assertive announcements to the assertive region only', async () => {
    const { container } = render(<LiveAnnouncer />)
    const polite = container.querySelector('[aria-live="polite"]') as HTMLElement
    const assertive = container.querySelector('[aria-live="assertive"]') as HTMLElement

    announce('Unable to save', 'assertive')
    await waitFor(() => expect(assertive.textContent).toBe('Unable to save'))
    expect(polite.textContent).toBe('')
  })

  it('ignores an empty announcement and keeps a stable snapshot reference', () => {
    const before = getAnnouncementSnapshot()
    announce('')
    expect(getAnnouncementSnapshot()).toBe(before)
  })

  it('notifies subscribers from a non-React caller and unsubscribes cleanly', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToAnnouncements(listener)
    announce('Draft saved')
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    announce('Draft saved again')
    expect(listener).not.toHaveBeenCalled()
  })

  it('survives a route change because it lives in the root shell', async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <div>
          <Outlet />
          <LiveAnnouncer />
        </div>
      ),
    })
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <p>home</p>,
    })
    const otherRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/other',
      component: () => <p>other</p>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute, otherRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <RouterProvider router={router as any} />,
    )
    await screen.findByText('home')
    const first = container.querySelector('[aria-live="polite"]')
    expect(first).not.toBeNull()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (router as any).navigate({ to: '/other' })
    await screen.findByText('other')

    expect(container.querySelector('[aria-live="polite"]')).toBe(first)
  })
})

describe('async pending state', () => {
  it('holds the admin sign-in button inert and named while the request is in flight', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      if (url === '/api/admin/session' && (init?.method ?? 'GET') === 'POST') return neverSettles()
      return unexpected()
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <AdminLogin />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Organizer secret'), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const button = await screen.findByRole('button', { name: /signing in/i })
    // Inert, not natively disabled: the browser blurs a control the instant it
    // gains the disabled attribute, and the reader who pressed this button
    // would lose their place in the page. aria-disabled keeps the focus.
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('prevents a double evaluation submission and shows pending on the trigger', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/public/evaluations' && method === 'GET') {
        return jsonResponse([
          {
            submissionId: SUBMISSION_ID,
            sessionTitle: 'A talk',
            roundId: 'round-1',
            roundNumber: 1,
            roundName: 'Initial review',
            roundStatus: 'open',
            rating: 3,
            comments: 'ok',
            updatedAt: '2026-08-08T09:00:00.000Z',
            previousRounds: [],
          },
        ])
      }
      if (url === '/api/public/evaluations' && method === 'POST') return neverSettles()
      return unexpected()
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <EvaluationsPage />
      </QueryClientProvider>,
    )

    const submit = await screen.findByRole('button', { name: 'Submit' })
    await user.click(submit)
    const pendingButton = await screen.findByRole('button', { name: /submitting/i })
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true')
    expect(pendingButton).toHaveAttribute('aria-busy', 'true')

    await user.click(pendingButton)
    await user.click(pendingButton)
    expect(callsTo('/api/public/evaluations', 'POST')).toHaveLength(1)
  })

  it('keeps other task rows usable while one row completes', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/public/tasks' && method === 'GET') {
        return jsonResponse([
          {
            id: 'task-1',
            kind: 'submit_bio',
            status: 'outstanding',
            submissionId: SUBMISSION_ID,
            submissionTitle: 'A talk',
            completedAt: null,
          },
          {
            id: 'task-2',
            kind: 'submit_headshot',
            status: 'outstanding',
            submissionId: SUBMISSION_ID,
            submissionTitle: 'A talk',
            completedAt: null,
          },
        ])
      }
      if (url === '/api/public/tasks/task-1/complete' && method === 'POST') return neverSettles()
      return unexpected()
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TasksPanel />
      </QueryClientProvider>,
    )

    const buttons = await screen.findAllByRole('button', { name: /mark complete/i })
    expect(buttons).toHaveLength(2)
    const pressed = buttons[0]!
    await user.click(pressed)

    // Row 1's POST never settles. Row 2 must stay usable: a page-wide pending
    // flag used to disable every row's control at once.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /mark complete/i })).toHaveLength(1)
    })
    const remaining = screen.getByRole('button', { name: /mark complete/i })
    expect(remaining).toBeEnabled()

    // Focus must NOT be handed to another row's live control while row 1 is
    // still in flight: completing a task cannot be undone here, and a held
    // Enter auto-repeats, so a moved focus completes a task nobody chose.
    expect(document.activeElement).not.toBe(remaining)
    expect(document.activeElement).toBe(pressed)
    expect(pressed).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByRole('button', { name: /marking complete/i })).toBe(pressed)
  })

  it('completes only the task that was pressed when Enter is held down', async () => {
    const user = userEvent.setup()
    const completed: string[] = []
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/public/tasks' && method === 'GET') {
        return jsonResponse([
          {
            id: 'task-1',
            kind: 'submit_bio',
            status: 'outstanding',
            submissionId: SUBMISSION_ID,
            submissionTitle: 'A talk',
            completedAt: null,
          },
          {
            id: 'task-2',
            kind: 'submit_headshot',
            status: 'outstanding',
            submissionId: SUBMISSION_ID,
            submissionTitle: 'A talk',
            completedAt: null,
          },
        ])
      }
      const match = /^\/api\/public\/tasks\/(.+)\/complete$/.exec(url)
      if (match !== null && method === 'POST') {
        completed.push(match[1]!)
        return neverSettles()
      }
      return unexpected()
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TasksPanel />
      </QueryClientProvider>,
    )

    const buttons = await screen.findAllByRole('button', { name: /mark complete/i })
    buttons[0]!.focus()
    // A native button repeats its click for as long as Enter is held.
    await user.keyboard('{Enter>3/}')

    await waitFor(() => expect(completed).toEqual(['task-1']))
  })

  it('shows a pending label on the acceptance controls', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (
        url ===
          `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/acceptance-preview` &&
        method === 'GET'
      ) {
        return jsonResponse({
          toEmail: 'speaker@example.test',
          subject: 'Accepted',
          body: 'Congratulations',
          accepted: false,
        })
      }
      if (
        url === `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/messages` &&
        method === 'GET'
      ) {
        return jsonResponse([])
      }
      if (
        url === `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/accept` &&
        method === 'POST'
      ) {
        return neverSettles()
      }
      return unexpected()
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CommunicationsPanel slug="demo-conf-2026" submissionId={SUBMISSION_ID} />
      </QueryClientProvider>,
    )

    // The decision is made in its confirmation now, so the in-flight control is
    // the confirm button — which is where aria-busy has to be, because it is
    // the control the organizer pressed and the one keeping focus.
    await user.click(await screen.findByRole('button', { name: 'Accept proposal' }))
    const accepting = await screen.findByRole('button', { name: 'Confirm acceptance' })
    await user.click(accepting)
    await waitFor(() => expect(accepting).toHaveAttribute('aria-busy', 'true'))
  })

  it('speaks a mutation failure exactly once, not once per live region', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/public/tasks' && method === 'GET') {
        return jsonResponse([
          {
            id: 'task-1',
            kind: 'submit_bio',
            status: 'outstanding',
            submissionId: SUBMISSION_ID,
            submissionTitle: 'A talk',
            completedAt: null,
          },
        ])
      }
      if (url === '/api/public/tasks/task-1/complete' && method === 'POST') {
        return jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500)
      }
      return unexpected()
    }
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <TasksPanel />
        <LiveAnnouncer />
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: /mark complete/i }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('Unable to complete that task.')
    // The inline alert IS the announcement. Repeating it through the app
    // announcer would make a screen reader say the same sentence twice.
    const assertive = container.querySelector('[aria-live="assertive"]:not([role])')
    expect(assertive?.textContent).toBe('')
  })

  it('speaks an evaluation outcome exactly once in both directions', async () => {
    const user = userEvent.setup()
    let failSubmit = false
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/public/evaluations' && method === 'GET') {
        return jsonResponse([
          {
            submissionId: SUBMISSION_ID,
            sessionTitle: 'A talk',
            roundId: 'round-1',
            roundNumber: 1,
            roundName: 'Initial review',
            roundStatus: 'open',
            rating: 3,
            comments: 'ok',
            updatedAt: '2026-08-08T09:00:00.000Z',
            previousRounds: [],
          },
        ])
      }
      if (url === '/api/public/evaluations' && method === 'POST') {
        return failSubmit
          ? jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500)
          : jsonResponse({
              submissionId: SUBMISSION_ID,
              sessionTitle: 'A talk',
              roundId: 'round-1',
              roundNumber: 1,
              roundName: 'Initial review',
              roundStatus: 'open',
              rating: 3,
              comments: 'ok',
              updatedAt: '2026-08-08T09:00:00.000Z',
              previousRounds: [],
            })
      }
      return unexpected()
    }
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <EvaluationsPage />
        <LiveAnnouncer />
      </QueryClientProvider>,
    )
    const polite = container.querySelector('[aria-live="polite"]:not([role])')
    const assertive = container.querySelector('[aria-live="assertive"]:not([role])')

    await user.click(await screen.findByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Evaluation submitted')).toBeInTheDocument()
    expect(polite?.textContent).toBe('')

    failSubmit = true
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to submit your evaluation.')
    expect(assertive?.textContent).toBe('')
  })

  it('gives the sign-in failure one alert and no duplicate announcement', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      if (url === '/api/admin/session' && (init?.method ?? 'GET') === 'POST') {
        return jsonResponse(
          { error: { code: 'unauthorized', message: 'Invalid organizer secret' } },
          401,
        )
      }
      return unexpected()
    }
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <AdminLogin />
        <LiveAnnouncer />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Organizer secret'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('Invalid organizer secret')
    // The per-field message repeats the text beside the control but is not a
    // live region, so it is not a second announcement.
    expect(document.getElementById('login-secret-error')).not.toHaveAttribute('role')
    expect(container.querySelector('[aria-live="assertive"]:not([role])')?.textContent).toBe('')
  })

  it('never puts aria-busy on the live region that has to announce', async () => {
    fetchHandler = () => neverSettles()
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <CommunicationsPanel slug="demo-conf-2026" submissionId={SUBMISSION_ID} />
      </QueryClientProvider>,
    )

    const status = await screen.findByRole('status')
    expect(status).not.toHaveAttribute('aria-busy')
    const busySection = container.querySelector('[aria-busy="true"]')
    expect(busySection).not.toBeNull()
    expect(within(busySection as HTMLElement).getByRole('status')).toBe(status)
  })
})
