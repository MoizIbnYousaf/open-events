import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getToken = vi.fn(async () => 'clerk-session-token')

vi.mock('@clerk/react', () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === 'signed-in' ? children : null,
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ getToken, isLoaded: true, isSignedIn: true }),
}))

import ClerkOrganizerAuth from '../../../src/app/features/admin/ClerkOrganizerAuth'

function renderClerk() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ClerkOrganizerAuth onAuthed={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('Clerk organizer exchange denial', () => {
  beforeEach(() => {
    getToken.mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'unauthorized', message: 'Unauthorized' } }),
            {
              status: 401,
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

  it('stops after a denied exchange and retries only after an explicit user action', async () => {
    const user = userEvent.setup()
    renderClerk()

    expect(
      await screen.findByText(/this account is not authorized for organizer access/i),
    ).toBeInTheDocument()
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/use the organizer secret below/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try clerk sign-in again/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
