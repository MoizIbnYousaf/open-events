import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import StartForm from '../../../src/app/features/public/StartForm'
import { startSession } from '../../../src/app/api/public'

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function renderStartForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <StartForm eventSlug="demo-conf-2026" formSlug="cfp" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchHandler = () => jsonResponse({ status: 'accepted' }, 202)
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('public email-link session start', () => {
  it('focuses the email input on load and submits POST /api/public/start', async () => {
    const user = userEvent.setup()
    renderStartForm()

    const email = screen.getByLabelText(/email/i)
    await waitFor(() => expect(email).toHaveFocus())
    await user.type(email, 'speaker@example.test')
    await user.click(screen.getByRole('button', { name: /start/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input) === '/api/public/start' && (init?.method ?? 'GET') === 'POST',
      )
      expect(call).toBeDefined()
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toEqual({
      email: 'speaker@example.test',
      eventSlug: 'demo-conf-2026',
      formSlug: 'cfp',
    })
  })

  it('shows generic accepted copy with no link, token, or email echo in the DOM', async () => {
    const user = userEvent.setup()
    renderStartForm()

    const email = await screen.findByLabelText(/email/i)
    await user.type(email, 'speaker@example.test')
    await user.click(screen.getByRole('button', { name: /start/i }))

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toContain('speaker@example.test')
    expect(rendered).not.toContain('token')
    expect(rendered).not.toContain('/api/public/session')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('disables the button with Sending… while the request is pending', async () => {
    const user = userEvent.setup()
    let resolveStart: ((response: Response) => void) | undefined
    fetchHandler = () =>
      new Promise<Response>((resolve) => {
        resolveStart = resolve
      })
    renderStartForm()

    const email = await screen.findByLabelText(/email/i)
    await user.type(email, 'speaker@example.test')
    const submit = screen.getByRole('button', { name: /start/i })
    await user.click(submit)

    expect(await screen.findByRole('button', { name: /sending/i })).toBeDisabled()
    resolveStart?.(jsonResponse({ status: 'accepted' }, 202))
    await waitFor(() => expect(screen.getByRole('button', { name: /start/i })).toBeEnabled())
  })

  it('shows a role=alert with retry on 500', async () => {
    const user = userEvent.setup()
    let failNext = true
    fetchHandler = () => {
      if (failNext) {
        failNext = false
        return jsonResponse({ error: { code: 'internal', message: 'Internal error' } }, 500)
      }
      return jsonResponse({ status: 'accepted' }, 202)
    }
    renderStartForm()

    const email = await screen.findByLabelText(/email/i)
    await user.type(email, 'speaker@example.test')
    await user.click(screen.getByRole('button', { name: /start/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  })

  it('focuses the first invalid field on a 400 validation response', async () => {
    const user = userEvent.setup()
    let resolveValidation: ((response: Response) => void) | undefined
    fetchHandler = () =>
      new Promise<Response>((resolve) => {
        resolveValidation = resolve
      })
    renderStartForm()

    const email = await screen.findByLabelText(/email/i)
    await user.type(email, 'not-an-email')
    const submit = screen.getByRole('button', { name: /start/i })
    await user.click(submit)

    // While the 400 is pending, the submit control retains focus.
    await waitFor(() => expect(submit).toHaveFocus())
    expect(email).not.toHaveFocus()

    resolveValidation?.(
      jsonResponse({ error: { code: 'validation_failed', message: 'Validation failed' } }, 400),
    )
    await waitFor(() => expect(email).toHaveFocus())
  })

  it('token hygiene: no URL token parsing, no client session endpoint, and no token storage', async () => {
    const storageGetSpy = vi.spyOn(Storage.prototype, 'getItem')
    const storageSetSpy = vi.spyOn(Storage.prototype, 'setItem')
    try {
      const user = userEvent.setup()
      renderStartForm()

      const email = await screen.findByLabelText(/email/i)
      await user.type(email, 'speaker@example.test')
      await user.click(screen.getByRole('button', { name: /start/i }))
      expect(await screen.findByText(/check your email/i)).toBeInTheDocument()

      expect(storageGetSpy).not.toHaveBeenCalled()
      expect(storageSetSpy).not.toHaveBeenCalled()
    } finally {
      storageGetSpy.mockRestore()
      storageSetSpy.mockRestore()
    }

    const apiSource = readFileSync(
      join(__dirname, '..', '..', '..', 'src', 'app', 'api', 'public.ts'),
      'utf8',
    )
    expect(apiSource).not.toContain('URLSearchParams')
    expect(apiSource).not.toContain('location.search')
    expect(apiSource).not.toContain('localStorage')
    expect(apiSource).not.toContain('sessionStorage')
    expect(apiSource).not.toContain('/api/public/session')

    for (const directory of [
      join(__dirname, '..', '..', '..', 'src', 'app', 'routes', '_public'),
      join(__dirname, '..', '..', '..', 'src', 'app', 'features', 'public'),
    ]) {
      // Optional scan directories are absent from Git until a route exists.
      if (!existsSync(directory)) continue
      for (const fileName of readdirSync(directory)) {
        if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) continue
        const source = readFileSync(join(directory, fileName), 'utf8')
        expect(source).not.toContain('URLSearchParams')
        expect(source).not.toContain('location.search')
        expect(source).not.toContain('localStorage')
        expect(source).not.toContain('sessionStorage')
        expect(source).not.toContain('/api/public/session')
      }
    }

    expect(startSession).toBeTypeOf('function')
    await startSession('speaker@example.test', 'demo-conf-2026', 'cfp')
    const startCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input) === '/api/public/start' && (init?.method ?? 'GET') === 'POST',
    )
    expect(startCall).toBeDefined()
    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toContain('token')
  })
})
