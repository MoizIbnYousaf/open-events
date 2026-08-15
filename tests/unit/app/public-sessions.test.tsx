import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PublicSessionsPage from '../../../src/app/features/public/PublicSessionsPage'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ eventSlug: 'demo-conf-2026' }),
}))

const ENVELOPE = {
  timezone: 'UTC',
  sessions: [
    {
      submissionId: 's1',
      title: 'Taming 40-Minute CI',
      speakers: ['Priya Raman'],
      speakerCards: [{ name: 'Priya Raman', jobTitle: 'Staff Engineer', company: 'Northwind' }],
      track: 'Platform & Infra',
      room: 'Room 2A',
      day: '2027-05-12',
      start: '2027-05-12T10:00:00.000Z',
      end: '2027-05-12T10:40:00.000Z',
      position: 0,
      format: 'Talk',
      description: `${'x'.repeat(160)} live-demo sentence.`,
    },
    {
      submissionId: 's2',
      title: 'Your AI Pair Programmer Is Lying to You',
      speakers: ['Marcus Okafor'],
      speakerCards: [{ name: 'Marcus Okafor', jobTitle: 'Engineer', company: 'Latticed' }],
      track: 'AI',
      room: 'Hall B',
      day: '2027-05-12',
      start: '2027-05-12T11:00:00.000Z',
      end: '2027-05-12T11:40:00.000Z',
      position: 1,
      format: 'Workshop',
      description: 'Short.',
    },
  ],
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PublicSessionsPage eventSlug="demo-conf-2026" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(ENVELOPE), {
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

describe('public sessions list widget', () => {
  it('shows title, time range, room, speaker title/company, format and track', async () => {
    mount()
    expect(await screen.findByText('Taming 40-Minute CI')).toBeInTheDocument()
    expect(screen.getAllByText(/Room 2A/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Priya Raman, Staff Engineer, Northwind/)).toBeInTheDocument()
    expect(screen.getByText('Format Talk')).toBeInTheDocument()
    expect(screen.getByText('Track Platform & Infra')).toBeInTheDocument()
    expect(screen.getAllByText(/10:00/).length).toBeGreaterThan(0)
  })

  it('narrows by title search and by speaker surname', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Taming 40-Minute CI')
    await user.type(screen.getByLabelText(/search sessions/i), 'Taming')
    await waitFor(() => {
      expect(screen.getByText('Taming 40-Minute CI')).toBeInTheDocument()
      expect(screen.queryByText('Your AI Pair Programmer Is Lying to You')).not.toBeInTheDocument()
    })
    await user.clear(screen.getByLabelText(/search sessions/i))
    await user.type(screen.getByLabelText(/search sessions/i), 'Raman')
    await waitFor(() => {
      expect(screen.getByText('Taming 40-Minute CI')).toBeInTheDocument()
      expect(screen.queryByText('Your AI Pair Programmer Is Lying to You')).not.toBeInTheDocument()
    })
  })

  it('filters by track, format and location', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Taming 40-Minute CI')
    await user.selectOptions(screen.getByLabelText('Track'), 'AI')
    expect(screen.queryByText('Taming 40-Minute CI')).not.toBeInTheDocument()
    expect(screen.getByText('Your AI Pair Programmer Is Lying to You')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Track'), 'All tracks')
    await user.selectOptions(screen.getByLabelText('Format'), 'Talk')
    expect(screen.getByText('Taming 40-Minute CI')).toBeInTheDocument()
    expect(screen.queryByText('Your AI Pair Programmer Is Lying to You')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Format'), 'All formats')
    await user.selectOptions(screen.getByLabelText('Location'), 'Hall B')
    expect(screen.getByText('Your AI Pair Programmer Is Lying to You')).toBeInTheDocument()
    expect(screen.queryByText('Taming 40-Minute CI')).not.toBeInTheDocument()
  })

  it('expands a truncated description with Show more', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('Taming 40-Minute CI')
    expect(screen.queryByText(/live-demo sentence/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show more/i }))
    expect(screen.getByText(/live-demo sentence/)).toBeInTheDocument()
  })
})
