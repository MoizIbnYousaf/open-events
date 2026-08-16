import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FilesPage from '../../../src/app/features/admin/FilesPage'

vi.mock('../../../src/app/features/nav/AppShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const SLUG = 'demo-conf-2026'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <FilesPage eventSlug={SLUG} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url === `/api/admin/events/${SLUG}/files`) {
        return jsonResponse([
          {
            id: 'f-1',
            ownerContactId: 'c-1',
            ownerName: 'Priya Raman',
            kind: 'slides',
            fileName: 'talk.pdf',
            updatedAt: '2026-08-01T10:00:00.000Z',
            versionCount: 2,
            sessionTitle: 'Taming CI',
          },
        ])
      }
      if (url.includes('/versions')) {
        return jsonResponse([
          {
            version: 2,
            fileName: 'talk-v2.pdf',
            current: true,
            createdAt: '2026-08-02T10:00:00.000Z',
          },
          {
            version: 1,
            fileName: 'talk.pdf',
            current: false,
            createdAt: '2026-08-01T10:00:00.000Z',
          },
        ])
      }
      if (url.includes('/comments')) {
        return jsonResponse([
          { authorName: 'Organizer', body: 'Looks good', createdAt: '2026-08-02T11:00:00.000Z' },
        ])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected' } }, 500)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('files library versions', () => {
  it('shows the approval trail when versions are opened', async () => {
    const user = userEvent.setup()
    mount()
    expect(await screen.findByText('talk.pdf')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /versions and comments/i }))
    expect(await screen.findByText(/approval trail: v1 → v2 \(current\)/i)).toBeInTheDocument()
    expect(screen.getByText(/looks good/i)).toBeInTheDocument()
  })
})
