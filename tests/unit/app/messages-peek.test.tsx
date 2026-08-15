import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MessagesPage from '../../../src/app/features/admin/MessagesPage'

const SLUG = 'demo-conf-2026'
const LOG = [
  {
    id: 'm-1',
    kind: 'acceptance',
    toEmail: 'priya@example.test',
    subject: 'You are accepted',
    body: 'Priya, your talk is on the programme.',
    createdAt: '2026-08-01T10:00:00.000Z',
    submissionId: 's-1',
  },
  {
    id: 'm-2',
    kind: 'reminder',
    toEmail: 'marcus@example.test',
    subject: 'Please upload slides',
    body: 'Marcus, slides are still missing.',
    createdAt: '2026-08-02T10:00:00.000Z',
    submissionId: 's-2',
  },
]

function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
      }
    >
      <MessagesPage eventSlug={SLUG} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(LOG), {
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

describe('messages list+peek', () => {
  it('opens one message body at a time from the list', async () => {
    const user = userEvent.setup()
    mount()
    expect(await screen.findByText('Priya, your talk is on the programme.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /please upload slides/i }))
    expect(screen.getByText('Marcus, slides are still missing.')).toBeInTheDocument()
    expect(screen.queryByText('Priya, your talk is on the programme.')).not.toBeInTheDocument()
  })
})
