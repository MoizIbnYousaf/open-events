import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  opensAt: null,
  closesAt: null,
  anonymize: false,
} as const

const ROUND_TWO = {
  id: 'round-2',
  eventId: 'event-1',
  number: 2,
  name: 'Round 2',
  status: 'open',
  opensAt: null,
  closesAt: null,
  anonymize: false,
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
      // Required on every round summary the server sends; an empty list is a
      // round nobody has reviewed yet, an absent one is not a real payload.
      reviews: [],
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
      reviews: [],
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
  // The committee page now also reads its roster and, per round, that round's
  // scorecard and reviewer pool. A stub that answers none of them puts the page
  // in its error state and every assertion below measures that instead.
  if (method === 'GET' && url === `/api/admin/events/${SLUG}/evaluations/committee`) {
    return jsonResponse([])
  }
  if (method === 'GET' && /\/rounds\/[^/]+\/(scorecard|pool)$/.test(url)) {
    return jsonResponse([])
  }
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

  // aria-busy tells assistive tech to hold off on the subtree it marks, so a
  // live region inside it is announced to nobody. The busy flag belongs to the
  // placeholder shapes; the sentence has to sit outside them.
  it('keeps the loading sentence outside the aria-busy placeholder subtree', async () => {
    fetchHandler = () => new Promise<Response>(() => undefined)
    mountPanel()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/loading the review committee/i)
    expect(status.closest('[aria-busy="true"]')).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
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

  it('assigns into the round the organizer picked, not whichever one is open', async () => {
    const user = userEvent.setup()
    // BOTH rounds open: round 2 shadows round 1 for every consumer that asks
    // for "the open round", which is the situation the defect describes.
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === ROUNDS_PATH) {
        return jsonResponse([{ ...ROUND_ONE, status: 'open' }, ROUND_TWO])
      }
      return defaultHandler(url, init)
    }
    mountPanel()

    await user.type(await screen.findByLabelText(/evaluator email/i), 'reviewer.two@example.test')
    // Round 1 is still open but round 2 shadows it, so before this control
    // existed there was no way to staff round 1 at all — and no feedback that
    // the assignment had landed somewhere else.
    await user.selectOptions(screen.getByLabelText(/^round$/i), 'round-1')
    await user.click(screen.getByRole('button', { name: /assign evaluator/i }))

    await waitFor(() =>
      expect(bodyOf(ASSIGNMENTS_PATH, 'POST')).toMatchObject({
        evaluatorEmail: 'reviewer.two@example.test',
        roundId: 'round-1',
      }),
    )
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
      // The assignment names its round. Without it the server picked whichever
      // round happened to be open, so an organizer could not staff round 1
      // once round 2 existed — and was told nothing either way.
      roundId: 'round-2',
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

  // Assignment now provisions a never-seen email. A leftover 404 is a
  // generic refusal, not "they have to sign in first".
  it.each([
    {
      code: 'not_found',
      status: 404,
      expected: /that evaluator could not be assigned/i,
      recovery: /check the email/i,
    },
    {
      code: 'conflict',
      status: 409,
      expected: /no open review round/i,
      recovery: /open a round above/i,
    },
    {
      code: 'validation_failed',
      status: 400,
      expected: /not an email address/i,
      recovery: /check it and try again/i,
    },
    {
      code: 'internal',
      status: 500,
      expected: /that evaluator could not be assigned/i,
      recovery: /that evaluator could not be assigned/i,
    },
  ])(
    'names the cause and the way forward when an assignment is refused with $code',
    async ({ code, status, expected, recovery }) => {
      const user = userEvent.setup()
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'POST' && url === ASSIGNMENTS_PATH) {
          return jsonResponse({ error: { code, message: 'raw server copy' } }, status)
        }
        return defaultHandler(url, init)
      }
      mountPanel()
      await screen.findByText('Reviewer One')

      await user.type(screen.getByLabelText(/evaluator email/i), 'nobody@example.test')
      await user.click(screen.getByRole('button', { name: /assign evaluator/i }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(expected)
      expect(alert).toHaveTextContent(recovery)
      expect(document.body.textContent ?? '').not.toContain('raw server copy')
    },
  )

  it('closes the live round and opens the next one by number', async () => {
    const user = userEvent.setup()
    mountPanel()
    await screen.findByText('Reviewer One')

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }))
    await waitFor(() =>
      expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(1),
    )
    await waitFor(() => expect(callsTo(ROUNDS_PATH, 'GET')).toBe(2))

    await user.click(screen.getByRole('button', { name: /open round 3/i }))
    await user.click(await screen.findByRole('button', { name: 'Confirm open' }))
    await waitFor(() => expect(callsTo(ROUNDS_PATH, 'POST')).toBe(1))
    expect(bodyOf(ROUNDS_PATH, 'POST')).toEqual({ number: 3, name: 'Round 3' })
  })

  // R2-1.3(b) / F-R3-5: closing a round is one-way, so the panel asks first
  // and a cancelled question writes nothing.
  it('asks before changing a round and writes nothing when the question is cancelled', async () => {
    const user = userEvent.setup()
    mountPanel()
    await screen.findByText('Reviewer One')

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/cannot be reopened/i)
    expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(0)

    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(0)

    await user.click(screen.getByRole('button', { name: /open round 3/i }))
    const openDialog = await screen.findByRole('dialog')
    expect(openDialog).toHaveTextContent(/starts taking ratings/i)
    await user.click(within(openDialog).getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(callsTo(ROUNDS_PATH, 'POST')).toBe(0)
  })

  // F-R3-1: a pending control is aria-disabled, not natively disabled, so the
  // reader keeps the place they pressed from. These three sites still carried
  // the native attribute and the browser blurred every one of them.
  it('keeps focus on each in-flight control instead of dropping it to the body', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') return new Promise<Response>(() => undefined)
      return defaultHandler(url, init)
    }
    mountPanel()
    await screen.findByText('Reviewer One')

    await user.type(screen.getByLabelText(/evaluator email/i), 'reviewer@example.test')
    const assign = screen.getByRole('button', { name: 'Assign evaluator' })
    await user.click(assign)
    const assigning = await screen.findByRole('button', { name: 'Assigning evaluator…' })
    expect(assigning).toHaveAttribute('aria-busy', 'true')
    expect(assigning).toHaveAttribute('aria-disabled', 'true')
    expect(assigning).not.toBeDisabled()
    expect(assigning).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)

    // The round triggers sit behind their confirm dialog while the request
    // runs, so the node itself is what carries the proof: aria-disabled and
    // busy, never the native attribute that blurs whatever is standing on it.
    cleanup()
    for (const name of [/close round 2/i, /open round 3/i]) {
      const roundUser = userEvent.setup()
      mountPanel()
      await screen.findByText('Reviewer One')
      const trigger = screen.getByRole('button', { name })
      await roundUser.click(trigger)
      await roundUser.click(await screen.findByRole('button', { name: /^confirm/i }))
      await waitFor(() => expect(trigger).toHaveAttribute('aria-busy', 'true'))
      expect(trigger).toHaveAttribute('aria-disabled', 'true')
      expect(trigger).not.toBeDisabled()
      cleanup()
    }
  })

  // V1-COMMS-FOCUS / V8-N1: the confirm dialog hands focus back to the trigger
  // it was opened from, and closing a round replaces that trigger — so focus
  // landed on <body>. The heading is the landing place.
  it('lands focus on the panel heading when a round change replaces its trigger', async () => {
    const user = userEvent.setup()
    mountPanel()
    await screen.findByText('Reviewer One')

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }))
    await waitFor(() =>
      expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(1),
    )

    const heading = screen.getByRole('heading', { name: 'Review committee' })
    await waitFor(() => expect(heading).toHaveFocus(), { timeout: 5000 })
    expect(document.activeElement).not.toBe(document.body)
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
    // Exact: the round scorecard below has a "Rating weight" of its own, and
    // this test is about the EVENT rubric's weight.
    await user.clear(screen.getByLabelText('Weight'))
    await user.type(screen.getByLabelText('Weight'), '3')
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

  // TA5-P1/P12: a round's status is a lifecycle state and wears the marker; a
  // criterion's weight is an annotation about that criterion and does not. And
  // while a close is really in the air, the open round's marker is what says
  // so — silently, because this card already owns the page's live region.
  it('marks a round status as state, a weight as annotation, and breathes the round being closed', async () => {
    const user = userEvent.setup()
    let releaseClose: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url === '/api/admin/events/demo-conf-2026/rounds/round-2/close') {
        return new Promise<Response>((resolve) => {
          releaseClose = resolve
        })
      }
      return committeeHandler(url, init)
    }
    await mountCommittee()

    await screen.findByText(/round 2 is open/i)
    const chipFor = (label: string): Element | null =>
      Array.from(document.querySelectorAll('[data-slot="badge"]')).find(
        (chip) => chip.textContent === label,
      ) ?? null

    expect(chipFor('Open')).toHaveAttribute('data-dot', '')
    expect(chipFor('Closed')).toHaveAttribute('data-dot', '')
    expect(chipFor('Weight 2')).not.toHaveAttribute('data-dot')
    expect(chipFor('Weight 2')?.className ?? '').not.toContain('before:')

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }))

    await waitFor(() => expect(chipFor('Open')).toHaveAttribute('data-pending', ''))
    // The label is the state the server last confirmed, and it stays true
    // until the server says otherwise. The round that is already closed is not
    // waiting on anything.
    expect(chipFor('Open')).toHaveTextContent('Open')
    expect(chipFor('Open')).not.toHaveAttribute('role')
    expect(chipFor('Open')).not.toHaveAttribute('aria-live')
    expect(chipFor('Closed')).not.toHaveAttribute('data-pending')

    releaseClose?.(jsonResponse({ ...ROUND_TWO, status: 'closed' }))
    // The wait ends and the marker settles back to rest.
    await waitFor(() => expect(chipFor('Open')).not.toHaveAttribute('data-pending'))
    expect(chipFor('Open')).toHaveAttribute('data-dot', '')
  })

  it('runs the rounds from the same page and adds no exit the rail already has', async () => {
    const user = userEvent.setup()
    await mountCommittee()

    expect(await screen.findByText(/round 2 is open/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }))
    await waitFor(() =>
      expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(1),
    )

    await user.click(screen.getByRole('button', { name: /open round 3/i }))
    await user.click(await screen.findByRole('button', { name: 'Confirm open' }))
    await waitFor(() => expect(callsTo(ROUNDS_PATH, 'POST')).toBe(1))
    expect(bodyOf(ROUNDS_PATH, 'POST')).toEqual({ number: 3, name: 'Round 3' })

    // Review committee is one of the rail's own destinations, so the rail is
    // already the way back to Event settings and marks where the reader stands.
    // A second exit in the content column would claim the two pages are parent
    // and child while the rail shows them as siblings (`BackLink.tsx`).
    expect(screen.queryByRole('link', { name: /^back to/i })).toBeNull()
  })

  // R2-1.3(b) / F-R3-5: the event-level surface asks the same question, in the
  // same words, and a cancelled question writes nothing.
  it('asks before changing a round from the event-level page', async () => {
    const user = userEvent.setup()
    await mountCommittee()
    await screen.findByText(/round 2 is open/i)

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/cannot be reopened/i)
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(0)
  })

  it('keeps focus on the in-flight Add criterion control', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      if ((init?.method ?? 'GET') === 'POST' && url === CRITERIA_PATH) {
        return new Promise<Response>(() => undefined)
      }
      return committeeHandler(url, init)
    }
    await mountCommittee()
    await screen.findByText('Overall fit')

    await user.type(screen.getByLabelText(/criterion name/i), 'Clarity')
    await user.click(screen.getByRole('button', { name: 'Add criterion' }))
    const inFlight = await screen.findByRole('button', { name: 'Add criterion' })
    await waitFor(() => expect(inFlight).toHaveAttribute('aria-busy', 'true'))
    expect(inFlight).not.toBeDisabled()
    expect(inFlight).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('lands focus on the rounds heading when a round change replaces its trigger', async () => {
    const user = userEvent.setup()
    await mountCommittee()
    await screen.findByText(/round 2 is open/i)

    await user.click(screen.getByRole('button', { name: /close round 2/i }))
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }))
    await waitFor(() =>
      expect(callsTo('/api/admin/events/demo-conf-2026/rounds/round-2/close', 'POST')).toBe(1),
    )

    const heading = screen.getByRole('heading', { name: 'Review rounds' })
    await waitFor(() => expect(heading).toHaveFocus(), { timeout: 5000 })
    expect(document.activeElement).not.toBe(document.body)
    // The inner waitFor's 5s allowance equals the suite's default testTimeout,
    // so under parallel-suite load the TEST clock could expire before the
    // waitFor did — a load flake, not a product signal. The test gets its own
    // budget so the only thing that can fail it is the focus contract.
  }, 15000)

  it('shows generic copy when the committee page cannot be loaded', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
    await mountCommittee()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('boom raw server copy')
  })
})
