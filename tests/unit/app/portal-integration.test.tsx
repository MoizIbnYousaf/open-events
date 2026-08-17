import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PortalPage from '../../../src/app/features/public/PortalPage'

// Portal composition contract: the signed-in portal page presents the
// speaker's submissions, their onboarding checklist, and the headshot
// uploader together, so the speaker completes onboarding from one place.
// Every stubbed body below is the exact shape the real server sends — the
// own-submissions envelope with its `accepted` flag, and the bare
// SpeakerTaskDto array from GET /api/public/tasks.

const SUBMISSIONS = {
  submissions: [
    {
      id: 'submission-1',
      title: 'A talk about integration',
      status: 'pending',
      decision: 'accepted',
      accepted: true,
      inviteAvailable: true,
      calendarEvent: {
        uid: 'submission-1@open-events',
        title: 'A talk about integration',
        start: '2026-05-14T10:00:00.000Z',
        end: '2026-05-14T11:00:00.000Z',
        location: 'Main Hall',
        description: '',
      },
      formSlug: 'cfp',
      version: 1,
      coSpeakerCount: 0,
      submittedAt: '2026-05-01T09:00:00.000Z',
    },
  ],
} as const

/** A co-speaker owns tasks but no submission: their own-list is always empty. */
const NO_SUBMISSIONS = { submissions: [] } as const

const TASKS = [
  {
    id: 'task-1',
    eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
    submissionId: 'submission-1',
    submissionTitle: 'A talk about integration',
    contactId: 'contact-1',
    kind: 'submit_bio',
    status: 'pending',
    position: 1,
    createdAt: '2026-05-01T08:00:00.000Z',
    completedAt: null,
  },
] as const

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
  fetchHandler = (url) => {
    if (url === '/api/public/submissions') return jsonResponse(SUBMISSIONS)
    if (url === '/api/public/tasks') return jsonResponse(TASKS)
    if (url === '/api/public/profile/headshot') {
      return jsonResponse({ error: { code: 'not_found', message: 'none' } }, 404)
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(fetchHandler(requestUrl(input), init)),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mountPortal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <PortalPage onUnauthenticated={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('portal composition', () => {
  it('renders submissions, onboarding checklist, and headshot uploader together', async () => {
    mountPortal()

    expect(await screen.findByText('A talk about integration')).toBeInTheDocument()
    expect(await screen.findByText('Submit your speaker bio')).toBeInTheDocument()
    expect(await screen.findByLabelText(/upload a headshot/i)).toBeInTheDocument()
    expect(screen.queryByText('Unable to load your tasks.')).not.toBeInTheDocument()
  })

  it('presents the portal as a navigable workspace with a useful overview', async () => {
    mountPortal()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Speaker portal' }),
    ).toBeInTheDocument()
    const overview = await screen.findByRole('region', { name: 'Portal overview' })
    expect(overview).toHaveTextContent('1 proposal')
    expect(overview).toHaveTextContent('1 accepted')

    const navigation = screen.getByRole('navigation', { name: 'Speaker portal sections' })
    expect(navigation).toBeInTheDocument()
    expect(navigation).toHaveTextContent('Proposals')
    expect(navigation).toHaveTextContent('Tasks')
    expect(navigation).toHaveTextContent('Profile')
    expect(navigation).toHaveTextContent('Files')
    expect(screen.getByText('A talk about integration').closest('section')).toHaveAttribute(
      'id',
      'portal-proposals',
    )
  })

  it('keeps a single page-owned h1 across every composed section', async () => {
    mountPortal()

    await screen.findByText('Submit your speaker bio')
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Speaker portal')
  })

  // V7-M2 / V7-N4, unpinned until now (RV3 NEW-3). A speaker who has just
  // signed in sees four empty tiles at once — submissions, tasks, headshot,
  // supporting document — and every one of them used to wear the same InboxIcon,
  // so four different absences read as one repeated stamp. An icon import is
  // exactly the kind of fix that drifts back silently, so the distinction is a
  // contract: four tiles, four different glyphs.
  it('draws a different glyph on each of the four empty tiles', async () => {
    fetchHandler = (url) => {
      if (url === '/api/public/submissions') return jsonResponse(NO_SUBMISSIONS)
      if (url === '/api/public/tasks') return jsonResponse([])
      if (url === '/api/public/profile/headshot') {
        return jsonResponse({ error: { code: 'not_found', message: 'none' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    mountPortal()

    await screen.findByText(/no submissions yet/i)
    let tiles: readonly Element[] = []
    await waitFor(() => {
      tiles = Array.from(document.querySelectorAll('[data-slot="empty-state-icon"]'))
      expect(tiles).toHaveLength(4)
    })

    const glyphs = tiles.map((tile) => tile.querySelector('svg')?.innerHTML ?? '')
    expect(glyphs.every((glyph) => glyph.length > 0)).toBe(true)
    expect(new Set(glyphs).size).toBe(4)
  })

  // Acceptance creates a checklist for EVERY contributor, and a co-speaker owns
  // none of the submission rows. Their onboarding must still be reachable, or
  // the submission can never reach 100% readiness.
  it('still shows the checklist and uploader to a speaker who owns no submission', async () => {
    fetchHandler = (url) => {
      if (url === '/api/public/submissions') return jsonResponse(NO_SUBMISSIONS)
      if (url === '/api/public/tasks') return jsonResponse(TASKS)
      if (url === '/api/public/profile/headshot') {
        return jsonResponse({ error: { code: 'not_found', message: 'none' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    mountPortal()

    expect(await screen.findByText('Submit your speaker bio')).toBeInTheDocument()
    expect(await screen.findByLabelText(/upload a headshot/i)).toBeInTheDocument()
    expect(screen.getByText(/no submissions yet/i)).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
