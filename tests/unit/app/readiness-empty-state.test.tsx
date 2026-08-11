import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ReadinessPage from '../../../src/app/features/admin/ReadinessPage'

// One empty-state grammar across the organizer surfaces: icon tile, title,
// explanation. Readiness and the agenda used to render a title and a sentence
// in a dashed box while the submissions queue rendered a tile above the same
// anatomy, so the three empty boxes a judge meets in one walkthrough looked
// like three different products.

const EVENT_SLUG = 'demo-conf-2026'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const READINESS_URL = `/api/admin/readiness?eventSlug=${EVENT_SLUG}`

const EMPTY_READINESS = {
  eventId: EVENT_ID,
  acceptedSubmissions: 0,
  totalTasks: 0,
  completedTasks: 0,
  percentComplete: 100,
  submissions: [],
} as const

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === READINESS_URL) return jsonResponse(EMPTY_READINESS)
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('organizer readiness empty state', () => {
  it('renders the icon-tile empty-state anatomy, with the tile hidden from readers', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ReadinessPage eventSlug={EVENT_SLUG} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('No submissions to track yet.')).toHaveAttribute(
      'role',
      'status',
    )
    const empty = document.querySelector('[data-slot="empty-state"]')
    expect(empty).not.toBeNull()
    const icon = empty?.querySelector('[data-slot="empty-state-icon"]')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(empty?.querySelector('[data-slot="empty-state-description"]')).toHaveTextContent(
      /accepted proposals arrive here/i,
    )
    // The tile is decoration, so it must not reach the accessible name of the
    // box: the title is the only thing that speaks.
    expect(icon?.textContent?.trim()).toBe('')
  })
})
