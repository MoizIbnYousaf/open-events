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
import EvaluationCommitteePage from '../../../src/app/features/admin/EvaluationCommitteePage'

/**
 * The organizer's round editor.
 *
 * A round could be named once and opened or closed, and every round of the
 * event shared one rubric — so a shortlisting pass and a final pass could not
 * ask different questions, and a question could only ever be a number with a
 * weight. These are the controls that make a round its own thing.
 */

const SLUG = 'demo-conf-2026'
const ROUNDS_PATH = `/api/admin/events/${SLUG}/rounds`
const COMMITTEE_PATH = `/api/admin/events/${SLUG}/evaluations/committee`
const CRITERIA_PATH = `/api/admin/events/${SLUG}/criteria`
const ROUND_ID = 'round-1'
const SCORECARD_PATH = `${ROUNDS_PATH}/${ROUND_ID}/scorecard`
const POOL_PATH = `${ROUNDS_PATH}/${ROUND_ID}/pool`

interface RoundBody {
  id: string
  eventId: string
  number: number
  name: string
  status: 'open' | 'closed'
  opensAt: string | null
  closesAt: string | null
  anonymize: boolean
}

let round: RoundBody
let scorecard: Record<string, unknown>[]
let pool: { contactId: string }[]
let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>

const SEATED = [
  {
    contactId: 'contact-1',
    email: 'reviewer.one@example.test',
    name: 'Reviewer One',
    addedAt: '2026-05-20T09:00:00.000Z',
    assignedCount: 0,
    completedCount: 0,
  },
  {
    contactId: 'contact-2',
    email: 'reviewer.two@example.test',
    name: 'Reviewer Two',
    addedAt: '2026-05-21T09:00:00.000Z',
    assignedCount: 0,
    completedCount: 0,
  },
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function bodyOf(url: string, method: string): Record<string, unknown> | null {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(
      ([input, init]) =>
        requestUrl(input) === url &&
        ((init as RequestInit | undefined)?.method ?? 'GET') === method,
    )
  const init = call?.[1] as RequestInit | undefined
  return init?.body === undefined
    ? null
    : (JSON.parse(String(init.body)) as Record<string, unknown>)
}

function defaultHandler(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET'
  if (method === 'GET' && url === ROUNDS_PATH) return jsonResponse([round])
  if (method === 'GET' && url === CRITERIA_PATH) return jsonResponse([])
  if (method === 'GET' && url === COMMITTEE_PATH) return jsonResponse(SEATED)
  if (method === 'GET' && url === SCORECARD_PATH) return jsonResponse(scorecard)
  if (method === 'GET' && url === POOL_PATH) return jsonResponse(pool)
  if (method === 'PUT' && url === `${ROUNDS_PATH}/${ROUND_ID}`) {
    const sent = JSON.parse(String(init?.body)) as Partial<RoundBody>
    round = { ...round, ...sent }
    return jsonResponse(round)
  }
  if (method === 'PUT' && url === SCORECARD_PATH) {
    const sent = JSON.parse(String(init?.body)) as { criteria: Record<string, unknown>[] }
    scorecard = sent.criteria.map((criterion, index) => ({
      ...criterion,
      id: `criterion-${index}`,
    }))
    return jsonResponse(scorecard)
  }
  if (method === 'PUT' && url === POOL_PATH) {
    const sent = JSON.parse(String(init?.body)) as { contactIds: string[] }
    pool = sent.contactIds.map((contactId) => ({ contactId }))
    return jsonResponse(pool)
  }
  // The page also carries a results table; this suite is not about it, so it
  // answers empty rather than 500. A page where an unrelated section is ALSO
  // failing has two alerts, and the assertions here address the one under test.
  if (url.endsWith('/results')) return jsonResponse([])
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

function mountCommittee() {
  const queryClient = createQueryClient()
  const rootRoute = createRootRoute()
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/evaluations',
    component: EvaluationCommitteePage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/admin/events/${SLUG}/evaluations`] }),
  })
  return render(
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  round = {
    id: ROUND_ID,
    eventId: 'event-1',
    number: 1,
    name: 'Round 1',
    status: 'open',
    opensAt: null,
    closesAt: null,
    anonymize: false,
  }
  scorecard = []
  pool = []
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

async function roundRegion(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: /round 1/i })
}

describe('an organizer configures a round on the page', () => {
  it('renames the round and it survives the reload', async () => {
    const user = userEvent.setup()
    mountCommittee()
    const region = await roundRegion()

    const name = within(region).getByLabelText(/round name/i)
    await user.clear(name)
    await user.type(name, 'Shortlisting')
    await user.click(within(region).getByRole('button', { name: /save round/i }))

    await waitFor(() =>
      expect(bodyOf(`${ROUNDS_PATH}/${ROUND_ID}`, 'PUT')).toMatchObject({ name: 'Shortlisting' }),
    )
    expect(await within(region).findByDisplayValue('Shortlisting')).toBeInTheDocument()
  })

  it('sets the window and sends it as an instant', async () => {
    const user = userEvent.setup()
    mountCommittee()
    const region = await roundRegion()

    await user.type(within(region).getByLabelText(/reviewing opens/i), '2026-06-01T09:00')
    await user.type(within(region).getByLabelText(/reviewing closes/i), '2026-06-14T17:00')
    await user.click(within(region).getByRole('button', { name: /save round/i }))

    await waitFor(() => {
      const sent = bodyOf(`${ROUNDS_PATH}/${ROUND_ID}`, 'PUT')
      expect(sent?.opensAt).toBe('2026-06-01T09:00:00.000Z')
      expect(sent?.closesAt).toBe('2026-06-14T17:00:00.000Z')
    })
  })

  it('makes the round blind', async () => {
    const user = userEvent.setup()
    mountCommittee()
    const region = await roundRegion()

    await user.click(within(region).getByLabelText(/hide reviewer identities/i))
    await user.click(within(region).getByRole('button', { name: /save round/i }))

    await waitFor(() =>
      expect(bodyOf(`${ROUNDS_PATH}/${ROUND_ID}`, 'PUT')).toMatchObject({ anonymize: true }),
    )
  })

  it('says when the server refuses the window', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      if ((init?.method ?? 'GET') === 'PUT' && url === `${ROUNDS_PATH}/${ROUND_ID}`) {
        return jsonResponse({ error: { code: 'validation_failed', message: 'bad' } }, 400)
      }
      return defaultHandler(url, init)
    }
    mountCommittee()
    const region = await roundRegion()

    await user.click(within(region).getByRole('button', { name: /save round/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('renders no results error: the results query is a real page dependency', async () => {
    mountCommittee()
    await screen.findByRole('heading', { level: 1, name: 'Review committee' })
    // A required read that 500s would put a SECOND alert on this page and make
    // every `getByRole('alert')` here ambiguous.
    expect(screen.queryByText(/results could not be loaded/i)).not.toBeInTheDocument()
  })
})

describe('an organizer builds the round scorecard', () => {
  it('adds a rating question with its scale', async () => {
    const user = userEvent.setup()
    mountCommittee()
    const region = await roundRegion()

    await user.type(within(region).getByLabelText(/question/i), 'Relevance')
    await user.selectOptions(within(region).getByLabelText(/answer type/i), 'rating')
    await user.clear(within(region).getByLabelText(/weight/i))
    await user.type(within(region).getByLabelText(/weight/i), '3')
    await user.click(within(region).getByRole('button', { name: /add question/i }))
    await user.click(within(region).getByRole('button', { name: /save scorecard/i }))

    await waitFor(() => {
      const sent = bodyOf(SCORECARD_PATH, 'PUT') as { criteria?: Record<string, unknown>[] } | null
      expect(sent?.criteria?.[0]).toMatchObject({ label: 'Relevance', kind: 'rating', weight: 3 })
    })
  })

  it('adds a choice question carrying its options and no weight', async () => {
    const user = userEvent.setup()
    mountCommittee()
    const region = await roundRegion()

    await user.type(within(region).getByLabelText(/question/i), 'Suggested track')
    await user.selectOptions(within(region).getByLabelText(/answer type/i), 'select')
    await user.type(within(region).getByLabelText(/choices/i), 'Platform & Infra\nAI Engineering')
    await user.click(within(region).getByRole('button', { name: /add question/i }))
    await user.click(within(region).getByRole('button', { name: /save scorecard/i }))

    await waitFor(() => {
      const sent = bodyOf(SCORECARD_PATH, 'PUT') as { criteria?: Record<string, unknown>[] } | null
      expect(sent?.criteria?.[0]).toMatchObject({
        label: 'Suggested track',
        kind: 'select',
        options: ['Platform & Infra', 'AI Engineering'],
        weight: null,
      })
    })
  })

  /**
   * A weight on a choice or on prose is a number nothing can use. The form
   * should not offer one, rather than accept it and have the server refuse.
   */
  it('offers no weight for a choice or for prose', async () => {
    const user = userEvent.setup()
    mountCommittee()
    const region = await roundRegion()

    await user.selectOptions(within(region).getByLabelText(/answer type/i), 'text')

    expect(within(region).queryByLabelText(/weight/i)).not.toBeInTheDocument()
  })

  it('reloads a saved scorecard rather than an empty one', async () => {
    scorecard = [
      {
        id: 'criterion-0',
        label: 'Relevance',
        kind: 'rating',
        weight: 3,
        position: 0,
        scale: { min: 1, max: 5 },
        options: null,
      },
      {
        id: 'criterion-1',
        label: 'Notes',
        kind: 'text',
        weight: null,
        position: 1,
        scale: null,
        options: null,
      },
    ]
    mountCommittee()
    const region = await roundRegion()

    // Scoped to the saved question list: "Notes" is also the label of an
    // answer-type option in the builder below, so a page-wide text match would
    // pass on the wrong element and prove nothing about what reloaded.
    const saved = await within(region).findByRole('list', { name: /scorecard questions/i })
    expect(within(saved).getByText('Relevance')).toBeInTheDocument()
    expect(within(saved).getByText('Notes')).toBeInTheDocument()
  })

  it('resets the weight after adding, so the next question does not inherit it', async () => {
    const user = userEvent.setup()
    mountCommittee()
    const region = await roundRegion()

    // First question carries a deliberate weight.
    await user.type(within(region).getByLabelText(/question/i), 'Originality')
    await user.selectOptions(within(region).getByLabelText(/answer type/i), 'rating')
    await user.clear(within(region).getByLabelText(/weight/i))
    await user.type(within(region).getByLabelText(/weight/i), '2')
    await user.click(within(region).getByRole('button', { name: /add question/i }))

    // The field retained 2, so a second question typed straight afterwards was
    // silently weighted 2 as well — and the weighted total the committee ranks
    // on was wrong in a way nothing on screen disclosed.
    expect(within(region).getByLabelText(/weight/i)).toHaveValue(1)

    await user.type(within(region).getByLabelText('Question', { exact: true }), 'Relevance')
    await user.click(within(region).getByRole('button', { name: /add question/i }))
    await user.click(within(region).getByRole('button', { name: /save scorecard/i }))

    await waitFor(() => {
      const sent = bodyOf(SCORECARD_PATH, 'PUT') as { criteria?: Record<string, unknown>[] } | null
      expect(sent?.criteria?.[0]).toMatchObject({ label: 'Originality', weight: 2 })
      expect(sent?.criteria?.[1]).toMatchObject({ label: 'Relevance', weight: 1 })
    })
  })
})

describe('an organizer pools reviewers into the round', () => {
  it('offers the seated committee and saves the chosen ones', async () => {
    const user = userEvent.setup()
    mountCommittee()
    const region = await roundRegion()

    await user.click(await within(region).findByLabelText(/Reviewer One/i))
    await user.click(within(region).getByRole('button', { name: /save reviewers/i }))

    await waitFor(() =>
      expect(bodyOf(POOL_PATH, 'PUT')).toMatchObject({ contactIds: ['contact-1'] }),
    )
  })

  it('shows who is already pooled', async () => {
    pool = [{ contactId: 'contact-2' }]
    mountCommittee()
    const region = await roundRegion()

    expect(await within(region).findByLabelText(/Reviewer Two/i)).toBeChecked()
    expect(within(region).getByLabelText(/Reviewer One/i)).not.toBeChecked()
  })
})
