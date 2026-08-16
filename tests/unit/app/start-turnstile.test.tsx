import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let clientConfiguration:
  | { readonly state: 'ready'; readonly siteKey: string; readonly required: true }
  | { readonly state: 'unavailable'; readonly siteKey: undefined; readonly required: true }

vi.mock('../../../src/lib/turnstile', () => ({
  turnstileClientConfiguration: () => clientConfiguration,
}))

vi.mock('../../../src/app/features/public/TurnstileWidget', () => ({
  default: ({ onToken }: { readonly onToken: (token: string) => void }) => (
    <button type="button" onClick={() => onToken('verified-widget-token')}>
      Complete human verification
    </button>
  ),
}))

import StartForm from '../../../src/app/features/public/StartForm'

function renderStart() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <StartForm eventSlug="demo-conf-2026" formSlug="cfp" />
    </QueryClientProvider>,
  )
}

describe('public start Turnstile availability', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 'accepted',
              guidance:
                'Check your email. Check your spam folder, wait two minutes, then try again.',
            }),
            { status: 202, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('visibly disables start when a production challenge is unavailable', async () => {
    clientConfiguration = { state: 'unavailable', siteKey: undefined, required: true }
    const user = userEvent.setup()
    renderStart()

    expect(screen.getByText(/human verification is temporarily unavailable/i)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /request a link/i })
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires the configured challenge token and submits it after verification', async () => {
    clientConfiguration = {
      state: 'ready',
      siteKey: 'configured-turnstile-site-key',
      required: true,
    }
    const user = userEvent.setup()
    renderStart()

    const submit = screen.getByRole('button', { name: /request a link/i })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/email/i), 'speaker@example.test')
    await user.click(screen.getByRole('button', { name: /complete human verification/i }))
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      turnstileToken: 'verified-widget-token',
    })
  })
})
