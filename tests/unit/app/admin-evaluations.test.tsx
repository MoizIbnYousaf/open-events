import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

import { createQueryClient } from '../../../src/app/query-client'
import EvaluationPanel from '../../../src/app/features/admin/EvaluationPanel'
import EvaluationCommitteePage from '../../../src/app/features/admin/EvaluationCommitteePage'

// Organizer review-committee contract. REQ-009's first clauses need a surface:
// the organizer staffs the committee, runs the rounds, and reads what each
// round concluded. Everything here goes through the committed admin API.

const SLUG = 'demo-conf-2026'
const SUBMISSION_ID = 'f0000000-0000-4000-8000-000000000900'
const ROUNDS_PATH = `/api/admin/events/${SLUG}/rounds`
const ASSIGNMENTS_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/assignments`
const SUMMARY_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/evaluation-summary`

const ROUND_ONE = {
  id: 'round-1',
  eventId: 'event-1',
  number: 1,
  name: 'Round 1',
  status: 'closed',
} as const

const ROUND_TWO = {
  id: 'round-2',
  eventId: 'event-1',
  number: 2,
  name: 'Round 2',
  status: 'open',
} as const

const ASSIGNMENT = {
  id: 'assignment-1',
  eventId: 'event-1',
  roundId: 'round-2',
  submissionId: SUBMISSION_ID,
  evaluatorContactId: 'contact-1',
  evaluatorEmail: 'reviewer.one@example.test',
  evaluatorName: 'Reviewer One',
  createdAt: '2026-05-20T09:00:00.000Z',
} as const

const SUMMARY = {
  submissionId: SUBMISSION_ID,
  eventId: 'event-1',
  title: 'Workshop proposal',
  currentRoundId: 'round-2',
  assignmentCount: 1,
  scoredCount: 0,
  scoreCount: 0,
  weightSum: 0,
  weightedTotal: 0,
  weightedAverageCentis: 0,
  criteria: [],
  rounds: [
    {
      roundId: 'round-1',
      number: 1,
      name: 'Round 1',
      status: 'closed',
      assignmentCount: 2,
      scoredCount: 2,
      scoreCount: 2,
      weightSum: 2,
      weightedTotal: 9,
      weightedAverageCentis: 450,
      criteria: [],
    },
    {
      roundId: 'round-2',
      number: 2,
      name: 'Round 2',
      status: 'open',
      assignmentCount: 1,
      scoredCount: 0,
      scoreCount: 0,
      weightSum: 0,
      weightedTotal: 0,
      weightedAverageCentis: 0,
      criteria: [],
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

function callsTo(url: string, method: string): number {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      requestUrl(input) === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ).length
}

function bodyOf(url: string, method: string): unknown {
  const call = fetchMock.mock.calls.find(
    ([input, init]) =>
      requestUrl(input) === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  )
  const init = call?.[1] as RequestInit | undefined
  return init?.body === undefined ? null : JSON.parse(String(init.body))
}

function mountPanel() {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <EvaluationPanel slug={SLUG} submissionId={SUBMISSION_ID} />
    </QueryClientProvider>,
  )
}

function defaultHandler(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET'
  if (method === 'GET' && url === ROUNDS_PATH) return jsonResponse([ROUND_ONE, ROUND_TWO])
  if (method === 'GET' && url === ASSIGNMENTS_PATH) return jsonResponse([ASSIGNMENT])
  if (method === 'GET' && url === SUMMARY_PATH) return jsonResponse(SUMMARY)
  if (method === 'POST' && url === ASSIGNMENTS_PATH) return jsonResponse(ASSIGNMENT)
  if (method === 'POST' && url === ROUNDS_PATH) {
    return jsonResponse({ ...ROUND_TWO, id: 'round-3', number: 3, name: 'Round 3' })
  }
  if (method === 'POST' && url === '/api/admin/events/demo-conf-2026/rounds/round-2/close') {
    return jsonResponse({ ...ROUND_TWO, status: 'closed' })
  }
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

beforeEach(() => {
  fetchHandler = defaultHandler
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    fetchHandler(requestUrl(input), init),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('organizer review committee panel', () => {
  it('announces its own loading state and owns no page heading', async () => {
    fetchHandler = () => new Promise<Response>(() => undefined)
    mountPanel()

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    expect(screen.getByRole('heading', { level: 2, name: /review committee/i })).toBeInTheDocument()
  })

  it('lists the committee roster and what each round concluded', async () => {
    mountPanel()

    expect(await screen.findByText('Reviewer One')).toBeInTheDocument()
    const rendered = document.body.textContent ?? ''
    expect(rendered).toContain('reviewer.one@example.test')
    // Round 1 finished at a weighted average of 4.50 and still says so.
    expect(rendered).toContain('4.50')
    expect(rendered).toContain('Round 1')
    expect(rendered).toContain('Round 2')
    expect(screen.getByText(/round 2 is open/i)).toBeInTheDocument()
  })

  it('says a round has no result yet rather than showing a zero average', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === SUMMARY_PATH) {
        return jsonResponse({ ...SUMMARY, rounds: [SUMMARY.rounds[1]] })
      }
      return defaultHandler(url, init)
    }
    mountPanel()

    expect(await screen.findByText(/no ratings recorded yet/i)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('0.00')
  })

  it('assigns an evaluator once and refetches the roster and the result', async () => {
    const user = userEvent.setup()
    mountPanel()
    await screen.findByText('Reviewer One')

    await user.type(screen.getByLabelText(/evaluator email/i), 'reviewer.two@example.test')
    await user.click(screen.getByRole('button', { name: /assign evaluator/i }))

    await waitFor(() => expect(callsTo(ASSIGNMENTS_PATH, 'POST')).toBe(1))
    expect(bodyOf(ASSIGNMENTS_PATH, 'POST')).toEqual({
      evaluatorEmail: 'reviewer.two@example.test',
    })
    await waitFor(() => expect(callsTo(ASSIGNMENTS_PATH, 'GET')).toBe(2))
    await waitFor(() => expect(callsTo(SUMMARY_PATH, 'GET')).toBe(2))
  })

  it('refuses an empty email in the field instead of posting it', async () => {
    const user = userEvent.setup()
    mountPanel()
    await screen.findByText('Reviewer One')

    await user.click(screen.getByRole('button', { name: /assign evaluator/i }))

    const email = screen.getByLabelText(/evaluator email/i)
    const error = await screen.findByText(/an evaluator email is required/i)
    expect(callsTo(ASSIGNMENTS_PATH, 'POST')).toBe(0)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(error.id).not.toBe('')
    expect(email.getAttribute('aria-describedby')).toBe(error.id)
  })

  it('reports a refused assignment without leaking raw server copy', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url === ASSIGNMENTS_PATH) {
        return jsonResponse({ error: { code: 'not_found', message: 'raw server copy' } }, 404)
      }
      return defaultHandler(url, init)
    }
    mountPanel()
    await screen.findByText('Reviewer One')

    await user.type(screen.getByLabelText(/evaluator email/i), 'nobody@example.test')
    await user.click(screen.getByRole('button', { name: /assign evaluator/i }))

    expect(await screen.findByText(/that evaluator could not be assigned/i)).toBeInTheDocument()
  })

  it('closes the live round and opens the next one by number', async () => {
    const user = userEvent.setup()
    mountPanel()
    await screen.findByText('Reviewer One')

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    await waitFor(() =>
      expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(1),
    )
    await waitFor(() => expect(callsTo(ROUNDS_PATH, 'GET')).toBe(2))

    await user.click(screen.getByRole('button', { name: /open round 3/i }))
    await waitFor(() => expect(callsTo(ROUNDS_PATH, 'POST')).toBe(1))
    expect(bodyOf(ROUNDS_PATH, 'POST')).toEqual({ number: 3, name: 'Round 3' })
  })

  it('shows generic copy when the committee cannot be loaded', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
    mountPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /the review committee could not be loaded/i,
    )
    expect(document.body.textContent ?? '').not.toContain('boom raw server copy')
  })
})

// The event-level half of REQ-009: the organizer defines the weighted criteria
// every rating is scored against and runs the rounds, without needing a
// particular submission in front of them.
describe('organizer review committee page', () => {
  const CRITERIA_PATH = `/api/admin/events/${SLUG}/criteria`

  const CRITERION = {
    id: 'criterion-1',
    eventId: 'event-1',
    name: 'Overall fit',
    weight: 2,
    position: 0,
  } as const

  function committeeHandler(url: string, init?: RequestInit): Response {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === CRITERIA_PATH) return jsonResponse([CRITERION])
    if (method === 'POST' && url === CRITERIA_PATH) return jsonResponse([CRITERION])
    if (method === 'GET' && url === ROUNDS_PATH) return jsonResponse([ROUND_ONE, ROUND_TWO])
    if (method === 'POST' && url === ROUNDS_PATH) {
      return jsonResponse({ ...ROUND_TWO, id: 'round-3', number: 3, name: 'Round 3' })
    }
    if (method === 'POST' && url === '/api/admin/events/demo-conf-2026/rounds/round-2/close') {
      return jsonResponse({ ...ROUND_TWO, status: 'closed' })
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }

  async function mountCommittee() {
    const rootRoute = createRootRoute()
    const committeeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/admin/events/$slug/evaluations',
      component: EvaluationCommitteePage,
    })
    const loginRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/admin',
      component: () => <div data-testid="login-redirect">Admin login</div>,
    })
    const eventRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/admin/events/$slug',
      component: () => <div data-testid="event-config">Event settings</div>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([committeeRoute, loginRoute, eventRoute]),
      history: createMemoryHistory({ initialEntries: [`/admin/events/${SLUG}/evaluations`] }),
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
    fetchHandler = committeeHandler
  })

  it('owns one h1 and lists the weighted criteria the committee scores against', async () => {
    await mountCommittee()

    await screen.findByRole('heading', { level: 1, name: /review committee/i })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(await screen.findByText('Overall fit')).toBeInTheDocument()
    expect(document.body.textContent ?? '').toContain('Weight 2')
  })

  it('adds a criterion with its weight through the committed criteria route', async () => {
    const user = userEvent.setup()
    await mountCommittee()

    await screen.findByText('Overall fit')
    await user.type(screen.getByLabelText(/criterion name/i), 'Speaker experience')
    await user.clear(screen.getByLabelText(/weight/i))
    await user.type(screen.getByLabelText(/weight/i), '3')
    await user.click(screen.getByRole('button', { name: /add criterion/i }))

    await waitFor(() => expect(callsTo(CRITERIA_PATH, 'POST')).toBe(1))
    // The route replaces the whole set, so an add has to resend what is
    // already defined or it would silently delete it.
    expect(bodyOf(CRITERIA_PATH, 'POST')).toEqual({
      criteria: [
        { name: 'Overall fit', weight: 2, position: 0 },
        { name: 'Speaker experience', weight: 3, position: 1 },
      ],
    })
    await waitFor(() => expect(callsTo(CRITERIA_PATH, 'GET')).toBe(2))
  })

  it('refuses a criterion with no name and says so against the field', async () => {
    const user = userEvent.setup()
    await mountCommittee()

    await screen.findByText('Overall fit')
    await user.click(screen.getByRole('button', { name: /add criterion/i }))

    const name = screen.getByLabelText(/criterion name/i)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    const describedBy = name.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(/name is required/i)
    expect(callsTo(CRITERIA_PATH, 'POST')).toBe(0)
  })

  it('runs the rounds from the same page and links back to event settings', async () => {
    const user = userEvent.setup()
    await mountCommittee()

    expect(await screen.findByText(/round 2 is open/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    await waitFor(() =>
      expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(1),
    )

    await user.click(screen.getByRole('button', { name: /open round 3/i }))
    await waitFor(() => expect(callsTo(ROUNDS_PATH, 'POST')).toBe(1))
    expect(bodyOf(ROUNDS_PATH, 'POST')).toEqual({ number: 3, name: 'Round 3' })

    expect(screen.getByRole('link', { name: /back to event settings/i })).toBeInTheDocument()
  })

  it('shows generic copy when the committee page cannot be loaded', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
    await mountCommittee()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('boom raw server copy')
  })
})
