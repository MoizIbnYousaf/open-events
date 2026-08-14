import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PublicSpeakersPage from '../../../src/app/features/public/PublicSpeakersPage'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ eventSlug: 'demo-conf-2026' }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  Outlet: () => null,
}))

const PEOPLE = {
  speakers: [
    {
      id: 'c-1',
      name: 'Priya Raman',
      jobTitle: 'Staff Engineer',
      company: 'Northwind',
      bio: 'Builds platforms.',
      hasHeadshot: true,
      photoUrl: '/api/public/events/demo-conf-2026/speakers/c-1/headshot',
      sessions: [],
    },
  ],
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PublicSpeakersPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(PEOPLE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('public speakers widget', () => {
  it('renders the stored headshot instead of initials when a photo URL exists', async () => {
    mount()
    const photo = await screen.findByRole('img', { name: 'Priya Raman' })
    expect(photo).toHaveAttribute(
      'src',
      '/api/public/events/demo-conf-2026/speakers/c-1/headshot',
    )
    expect(screen.getByText('Priya Raman')).toBeInTheDocument()
    expect(screen.getByText(/Staff Engineer/)).toBeInTheDocument()
    expect(screen.getByText(/Northwind/)).toBeInTheDocument()
  })
})
