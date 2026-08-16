import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../../../src/app/query-client'
import SpeakersPage from '../../../src/app/features/admin/SpeakersPage'

// The organizer's view of the people on the programme. Every speaker-facing
// surface existed first, so the work speakers did landed on a screen nobody had.

const SLUG = 'demo-conf-2026'
const SPEAKERS_URL = `/api/admin/events/${SLUG}/speakers`

const ROSTER = [
  {
    contactId: 'c-1',
    email: 'ada@example.test',
    name: 'Ada Okafor',
    bio: 'Platform engineer.',
    proposalCount: 2,
    sessionCount: 1,
    taskCount: 3,
    taskCompletedCount: 3,
    outstandingTaskCount: 0,
    hasHeadshot: true,
    profileComplete: true,
    jobTitle: 'Staff Engineer',
    company: 'Latticework',
    travelNotes: '',
    workflowStatus: 'confirmed',
  },
  {
    contactId: 'c-2',
    email: 'marcus@example.test',
    name: 'Marcus Raman',
    bio: null,
    proposalCount: 1,
    sessionCount: 0,
    taskCount: 2,
    taskCompletedCount: 0,
    outstandingTaskCount: 2,
    hasHeadshot: false,
    profileComplete: false,
    jobTitle: '',
    company: '',
    travelNotes: '',
    workflowStatus: 'invited',
  },
]

let fetchHandler: (url: string, init?: RequestInit) => Response

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mount() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SpeakersPage eventSlug={SLUG} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchHandler = (url) => {
    if (url === SPEAKERS_URL) return jsonResponse(ROSTER)
    if (url.endsWith('/forms') || url.endsWith('/submissions') || url.endsWith('/assignments')) {
      return jsonResponse([])
    }
    if (url.endsWith('/speakers/templates') || url.endsWith('/messages')) return jsonResponse([])
    return jsonResponse({ error: { code: 'internal', message: 'unexpected' } }, 500)
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      fetchHandler(typeof input === 'string' ? input : String(input), init),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('the organizer speaker roster', () => {
  it('lists everyone with the numbers an organizer chases', async () => {
    mount()

    const list = await screen.findByRole('list', { name: /speakers/i })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Ada Okafor')
    expect(rows[0]).toHaveTextContent(/2 proposal/i)
    // The half-done profile is the reason this screen exists: an organizer
    // needs to know who still owes a bio or a headshot.
    expect(rows[1]).toHaveTextContent(/profile incomplete/i)
    expect(rows[0]).toHaveTextContent(/profile complete/i)
  })

  it('filters on name or email, and says how many are shown', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('list', { name: /speakers/i })

    await user.type(screen.getByLabelText(/search speakers/i), 'marcus@')

    // Matched on the EMAIL, because whoever is looking has whichever of the
    // two identifiers they were given.
    await waitFor(() => {
      const rows = within(screen.getByRole('list', { name: /speakers/i })).getAllByRole('listitem')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveTextContent('Marcus Raman')
    })
    // Announced, so filtering is legible to someone who cannot see the list shrink.
    expect(screen.getByText(/1 of 2 speaker\(s\) shown/i)).toBeInTheDocument()
  })

  it('says so plainly when nobody matches', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('list', { name: /speakers/i })

    await user.type(screen.getByLabelText(/search speakers/i), 'zzz')

    expect(await screen.findByText(/nobody matches that/i)).toBeInTheDocument()
  })

  it('renders exactly one page-owned h1', async () => {
    mount()
    await screen.findByRole('list', { name: /speakers/i })

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Speakers')
  })

  it('offers a published-form assignment control', async () => {
    mount()
    expect(
      await screen.findByRole('heading', { name: /assign a published form/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^assign form$/i })).toBeDisabled()
  })

  it('filters the roster by workflow status', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('list', { name: /speakers/i })

    await user.selectOptions(screen.getByLabelText(/filter by status/i), 'confirmed')

    await waitFor(() => {
      const rows = within(screen.getByRole('list', { name: /speakers/i })).getAllByRole('listitem')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveTextContent('Ada Okafor')
    })
  })

  it('filters the roster to speakers with outstanding tasks', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('list', { name: /speakers/i })

    await user.selectOptions(screen.getByLabelText(/filter by task completion/i), 'incomplete')

    await waitFor(() => {
      const rows = within(screen.getByRole('list', { name: /speakers/i })).getAllByRole('listitem')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveTextContent('Marcus Raman')
    })
  })

  it('exposes a CSV file input and an outstanding-task reminder', async () => {
    mount()
    await screen.findByRole('list', { name: /speakers/i })
    expect(screen.getByLabelText(/import speakers csv file/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /send reminder to speakers with outstanding tasks/i }),
    ).toBeInTheDocument()
  })

  it('posts the CSV the organizer typed to the import route', async () => {
    const user = userEvent.setup()
    const posts: string[] = []
    fetchHandler = (url, init) => {
      if (url === SPEAKERS_URL) return jsonResponse(ROSTER)
      if (url === `${SPEAKERS_URL}/import` && (init?.method ?? 'GET') === 'POST') {
        posts.push(typeof init?.body === 'string' ? init.body : '')
        return jsonResponse({ imported: 1 })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected' } }, 500)
    }
    mount()
    await screen.findByRole('list', { name: /speakers/i })
    await user.type(
      screen.getByLabelText(/^import csv$/i),
      'name,email\nGrace Hopper,grace@example.test',
    )
    await user.click(screen.getByRole('button', { name: /import speakers/i }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toContain('Grace Hopper')
    expect(posts[0]).toContain('grace@example.test')
  })

  it('saves an organizer bio edit through the speaker profile form', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    fetchHandler = (url) => {
      calls.push(url)
      if (url === SPEAKERS_URL) return jsonResponse(ROSTER)
      if (url === `${SPEAKERS_URL}/c-1` || url.endsWith('/speakers/c-1')) {
        return jsonResponse({ ...ROSTER[0], bio: 'SBEK-ORG-EDIT-01' })
      }
      return jsonResponse([])
    }
    mount()
    const bio = await screen.findByLabelText('Bio', { selector: '#bio-c-1' })
    await user.clear(bio)
    await user.type(bio, 'SBEK-ORG-EDIT-01')
    await user.click(screen.getAllByRole('button', { name: /save profile/i })[0]!)

    await waitFor(() => {
      expect(calls.some((url) => url.includes('/speakers/c-1'))).toBe(true)
    })
  })
})
