import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PublicSpeakerDetailPage from '../../../src/app/features/public/PublicSpeakerDetailPage'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ eventSlug: 'demo-conf-2026', contactId: 'c-1' }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}))

const PERSON = {
  id: 'c-1',
  name: 'Marcus Okafor',
  jobTitle: 'Engineer',
  company: 'Latticed',
  bio: '',
  photoUrl: '',
  sessions: [
    {
      submissionId: 's-1',
      title: 'Taming 40-Minute CI',
      day: '2026-05-13',
      start: '2026-05-13T09:00:00.000Z',
      end: '2026-05-13T10:00:00.000Z',
      room: 'Main hall',
    },
  ],
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PublicSpeakerDetailPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string | URL | Request) =>
        new Response(
          JSON.stringify(
            String(input).includes('/schedule')
              ? {
                  timezone: 'Europe/Berlin',
                  sessions: [],
                }
              : PERSON,
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('public speaker detail', () => {
  it('prints session clocks in the event timezone, not the raw UTC instant', async () => {
    mount()
    const line = await screen.findByText(/Taming 40-Minute CI/)
    expect(line.textContent).toContain('11:00')
    expect(line.textContent).toContain('12:00')
    expect(line.textContent).not.toContain('T09:00:00.000Z')
  })
})
