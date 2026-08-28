import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ProgrammeTimelineDto,
  ProgrammeTimelineItemDto,
} from '../../../src/application/dtos/programme-timeline.dto'
import ProgrammeTimelinePage from '../../../src/app/features/admin/ProgrammeTimelinePage'
import {
  parseProgrammeTimelineSearch,
  programmeTimelineSearchSchema,
} from '../../../src/app/features/admin/programme-timeline-search'
import { createQueryClient } from '../../../src/app/query-client'
import { Route as ProgrammeTimelineRoute } from '../../../src/app/routes/admin_.events.$slug_.timeline'

const EVENT_SLUG = 'demo-conf-2026'
const SUBMISSION_ID = 'submission-1'

const ITEMS: readonly ProgrammeTimelineItemDto[] = [
  {
    id: 'review_saved:assignment-1',
    kind: 'review_saved',
    category: 'reviews',
    occurredAt: '2026-08-28T12:00:00.000Z',
    title: 'Latest review saved',
    detail: 'Reviewer One · Round one · My talk',
    submissionId: SUBMISSION_ID,
    submissionTitle: 'My talk',
  },
  {
    id: 'proposal_submitted:submission-1',
    kind: 'proposal_submitted',
    category: 'submissions',
    occurredAt: '2026-08-27T12:00:00.000Z',
    title: 'Proposal submitted',
    detail: 'My talk',
    submissionId: SUBMISSION_ID,
    submissionTitle: 'My talk',
  },
]

function response(
  category: ProgrammeTimelineDto['category'] = 'all',
  items: readonly ProgrammeTimelineItemDto[] = ITEMS,
  truncated = false,
): ProgrammeTimelineDto {
  return { category, items, limit: 100, truncated }
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

async function mount(initialEntry = `/admin/events/${EVENT_SLUG}/timeline`) {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/admin/events/$slug/timeline',
    validateSearch: programmeTimelineSearchSchema,
    component: ProgrammeTimelinePage,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('/timeline')) return Response.json(response())
      if (url.endsWith('/timeline?category=reviews')) {
        return Response.json(response('reviews', [ITEMS[0]!]))
      }
      return Response.json({ error: { code: 'internal', message: 'unexpected' } }, { status: 500 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('programme timeline search state', () => {
  it('keeps only a known category and the global tour marker', () => {
    expect(ProgrammeTimelineRoute.options.path).toBe('/admin/events/$slug/timeline')
    expect(parseProgrammeTimelineSearch({ category: 'reviews', tour: true })).toEqual({
      category: 'reviews',
      tour: '1',
    })
    expect(parseProgrammeTimelineSearch({ category: 'unknown' })).toEqual({ category: 'all' })
  })
})

describe('ProgrammeTimelinePage', () => {
  it('renders the source-backed disclosure, newest-first milestones, and related proposal links', async () => {
    await mount()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Programme timeline' }),
    ).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText(/do not preserve every edit/i)).toBeVisible()
    const milestones = await screen.findByRole('list', { name: 'Programme lifecycle milestones' })
    expect(milestones).toHaveTextContent('Latest review saved')
    expect(milestones.textContent?.indexOf('Latest review saved')).toBeLessThan(
      milestones.textContent?.indexOf('Proposal submitted') ?? 0,
    )
    expect(screen.getAllByRole('link', { name: 'Open proposal My talk' })[0]).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`,
    )
  })

  it('shares the category in the URL, preserves tour state, and requests only that lane', async () => {
    const user = userEvent.setup()
    const router = await mount(`/admin/events/${EVENT_SLUG}/timeline?tour=1`)
    await screen.findByRole('list', { name: 'Programme lifecycle milestones' })

    await user.selectOptions(screen.getByLabelText('Show milestones'), 'reviews')
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ category: 'reviews', tour: '1' })
      expect(screen.getByText('1 milestone, newest first.')).toBeVisible()
    })
    expect(
      (fetch as ReturnType<typeof vi.fn>).mock.calls.some(([input]) =>
        requestUrl(input as RequestInfo | URL).endsWith('/timeline?category=reviews'),
      ),
    ).toBe(true)
  })

  it('states the one-hundred-item bound when older milestones were omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(response('all', ITEMS, true))),
    )
    await mount()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Showing the latest 100 matching milestones',
    )
  })

  it('renders an expired organizer session as a bare recovery page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'unauthorized', message: 'Unauthorized' } },
          { status: 401 },
        ),
      ),
    )
    await mount()

    expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Event' })).not.toBeInTheDocument()
  })
})
