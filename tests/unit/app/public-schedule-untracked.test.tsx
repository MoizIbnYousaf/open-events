import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PublicSchedulePage from '../../../src/app/features/public/PublicSchedulePage'
import { UNTRACKED_GROUP_LABEL } from '../../../src/domain/agenda'

// A published session with no track, on the surface an attendee reads. The
// schedule renders the same domain derivation the organizer board does, so the
// group it files an untracked session under has to be named on both — and the
// track cell of every other view has to say the same word rather than paint an
// empty chip, which is what a `Badge` wrapped around nothing renders as.

const EVENT_SLUG = 'demo-conf-2026'
const SCHEDULE_URL = `/api/public/events/${EVENT_SLUG}/schedule`

const ENVELOPE = {
  timezone: 'Europe/Berlin',
  sessions: [
    {
      submissionId: 'submission-1',
      title: 'My talk',
      track: 'Talk',
      room: 'Main hall',
      day: '2026-05-13',
      start: '2026-05-13T09:00:00.000Z',
      end: '2026-05-13T10:00:00.000Z',
      position: 0,
    },
    {
      submissionId: 'submission-2',
      title: 'Hallway session',
      track: '',
      room: 'Main hall',
      day: '2026-05-13',
      start: '2026-05-13T11:00:00.000Z',
      end: '2026-05-13T12:00:00.000Z',
      position: 1,
    },
  ],
} as const

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function renderPage(): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <PublicSchedulePage eventSlug={EVENT_SLUG} />
    </QueryClientProvider>,
  )
  await screen.findAllByText('Hallway session')
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === SCHEDULE_URL) return jsonResponse(ENVELOPE)
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

/** The row of a view whose title cell names `title`. */
function rowFor(view: HTMLElement, title: string): HTMLElement {
  const row = within(view).getByText(title).closest('tr')
  expect(row).not.toBeNull()
  return row as HTMLElement
}

describe('public schedule: sessions with no track', () => {
  it('never renders an empty chip for a session that has no track', async () => {
    await renderPage()

    for (const name of ['List', 'Day', 'Week', 'Room']) {
      const view = await screen.findByRole('region', { name })
      const row = rowFor(view, 'Hallway session')
      expect(row).toHaveTextContent(UNTRACKED_GROUP_LABEL)
      for (const badge of Array.from(row.querySelectorAll('[data-slot="badge"]'))) {
        expect(badge.textContent?.trim()).not.toBe('')
      }
      // The session that HAS a track still wears the chip.
      const tracked = rowFor(view, 'My talk')
      expect(tracked.querySelector('[data-slot="badge"]')).toHaveTextContent('Talk')
    }
  })

  it('names the untracked group in the Track view instead of leaving the cell blank', async () => {
    await renderPage()
    const view = await screen.findByRole('region', { name: 'Track' })

    const row = rowFor(view, 'Hallway session')
    expect(row).toHaveTextContent(UNTRACKED_GROUP_LABEL)
    expect(rowFor(view, 'My talk')).toHaveTextContent('Talk')
    // No cell of the grouped view is empty: a blank grouping key reads as the
    // group above it, which is how an untracked session came to look tracked.
    for (const cell of Array.from(row.querySelectorAll('td'))) {
      expect(cell.textContent?.trim()).not.toBe('')
    }
  })

  it('keeps the whole page free of empty badges', async () => {
    await renderPage()

    for (const badge of Array.from(document.querySelectorAll('[data-slot="badge"]'))) {
      expect(badge.textContent?.trim()).not.toBe('')
    }
  })
})
