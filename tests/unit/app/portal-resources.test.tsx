import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PortalResources from '../../../src/app/features/public/PortalResources'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

function renderResources() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PortalResources />
    </QueryClientProvider>,
  )
}

describe('PortalResources', () => {
  it('renders useful Markdown and safe links without executing raw HTML or unsafe URLs', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'guide',
            eventId: 'event-1',
            kind: 'markdown',
            title: 'Speaker guide',
            body: '# Welcome\n\n- Bring your slides\n\n<script>alert(1)</script>\n\n[Bad](javascript:alert(1))',
            url: null,
            position: 0,
            published: true,
            createdAt: '2026-08-17T11:00:00.000Z',
            updatedAt: '2026-08-17T11:00:00.000Z',
          },
          {
            id: 'map',
            eventId: 'event-1',
            kind: 'link',
            title: 'Venue map',
            body: null,
            url: 'https://example.com/map',
            position: 1,
            published: true,
            createdAt: '2026-08-17T11:00:00.000Z',
            updatedAt: '2026-08-17T11:00:00.000Z',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    renderResources()

    expect(await screen.findByRole('heading', { name: 'Resources' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument()
    expect(screen.getByText('Bring your slides')).toBeInTheDocument()
    expect(screen.queryByText('alert(1)')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Bad' })).not.toBeInTheDocument()
    const map = screen.getByRole('link', { name: 'Venue map' })
    expect(map).toHaveAttribute('href', 'https://example.com/map')
    expect(map).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders a recoverable error state', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'internal', message: 'raw' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )

    renderResources()

    expect(await screen.findByText(/resources are unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})
