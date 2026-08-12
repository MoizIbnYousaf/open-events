import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

import EvaluationCommitteePage from '../../../src/app/features/admin/EvaluationCommitteePage'

/**
 * The results table, as the organizer ranking proposals meets it.
 *
 * The weighted total was readable one proposal at a time, so the question a
 * programme committee actually meets to answer — which proposals came out on
 * top — had no screen behind it. These cases assert what the table shows ON
 * ARRIVAL and what the sort does, because a ranking that is right only after
 * you click something is not a ranking.
 */
const RESULTS = [
  {
    submissionId: 'sub-low',
    title: 'Taming 40-Minute CI',
    weightedAverageCentis: 300,
    assignmentCount: 2,
    scoredCount: 2,
    decision: 'pending',
    contributors: [
      {
        contactId: 'c1',
        name: 'Priya Raman',
        email: 'priya@example.test',
        role: 'primary',
        position: 0,
      },
      {
        contactId: 'c2',
        name: 'Marcus Okafor',
        email: 'marcus@example.test',
        role: 'co-speaker',
        position: 1,
      },
    ],
  },
  {
    submissionId: 'sub-high',
    title: 'Your AI Pair Programmer',
    weightedAverageCentis: 500,
    assignmentCount: 1,
    scoredCount: 1,
    decision: 'accepted',
    contributors: [],
  },
  {
    submissionId: 'sub-unscored',
    title: 'Nobody has read this yet',
    weightedAverageCentis: null,
    assignmentCount: 1,
    scoredCount: 0,
    decision: 'pending',
    contributors: [],
  },
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/results')) return jsonResponse(RESULTS)
      if (url.endsWith('/criteria')) return jsonResponse([])
      if (url.endsWith('/rounds')) return jsonResponse([])
      if (url.endsWith('/evaluations/committee')) return jsonResponse([])
      return jsonResponse([])
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const SLUG = 'demo-conf-2026'

/** The page reads its event from the route, so it needs a real router context. */
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = userEvent.setup()
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
  render(
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  )
  return { user }
}

/** Proposal titles in the order the table renders them. */
async function rowOrder(): Promise<readonly string[]> {
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row').slice(1)
  return rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '')
}

describe('the results table ranks proposals by what the committee scored them', () => {
  it('shows the strongest proposal first on arrival, with no clicking', async () => {
    mount()
    await waitFor(async () => {
      const order = await rowOrder()
      expect(order[0]).toContain('Your AI Pair Programmer')
    })
    const order = await rowOrder()
    expect(order[1]).toContain('Taming 40-Minute CI')
  })

  it('sorts an unscored proposal last, not as a zero', async () => {
    mount()
    await waitFor(async () => {
      expect((await rowOrder())[0]).toContain('Your AI Pair Programmer')
    })
    // Bottom in the default (highest-first) order.
    expect((await rowOrder()).at(-1)).toContain('Nobody has read this yet')
  })

  it('reverses the ranking, and STILL keeps the unscored proposal last', async () => {
    const { user } = mount()
    await waitFor(async () => {
      expect((await rowOrder())[0]).toContain('Your AI Pair Programmer')
    })
    await user.click(screen.getByRole('button', { name: /sort by score/i }))
    await waitFor(async () => {
      expect((await rowOrder())[0]).toContain('Taming 40-Minute CI')
    })
    const reversed = await rowOrder()
    expect(reversed[1]).toContain('Your AI Pair Programmer')
    // "No score" is not a low score — it must not rise to the top when the
    // ranking flips, or an unread proposal would look like the worst one.
    expect(reversed.at(-1)).toContain('Nobody has read this yet')
  })

  it('renders the aggregate readably and says when there is none', async () => {
    mount()
    expect(await screen.findByText('5.0')).toBeInTheDocument()
    expect(screen.getByText('3.0')).toBeInTheDocument()
    expect(screen.getByText('Not yet reviewed')).toBeInTheDocument()
  })

  it('names co-authors with their roles on the row', async () => {
    mount()
    const row = await screen.findByText(/Priya Raman \(primary\), Marcus Okafor \(co-speaker\)/)
    expect(row).toBeInTheDocument()
  })

  it('offers an export control for the results', async () => {
    mount()
    expect(await screen.findByRole('button', { name: /export results/i })).toBeInTheDocument()
  })
})
