import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../../../src/app/query-client'
import AdminLogin from '../../../src/app/features/admin/AdminLogin'

const SESSION_TOKEN = 'test-session-token'
const EXPIRES_AT = '2026-08-08T12:00:00.000Z'

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function fetchCall(url: string, method: string): RequestInit | undefined {
  const call = fetchMock.mock.calls.find(([input, init]) => {
    return requestUrl(input) === url && (init?.method ?? 'GET') === method
  })
  return call?.[1]
}

async function mountLogin() {
  const rootRoute = createRootRoute()
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    component: AdminLogin,
  })
  const destinationRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug',
    component: () => <div data-testid="login-destination">Admin events</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([loginRoute, destinationRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin'] }),
  })
  await router.load()
  const queryClient = createQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router }
}

beforeEach(() => {
  fetchHandler = () =>
    jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('admin login screen', () => {
  it('renders the login form and focuses the secret field', async () => {
    await mountLogin()

    const secret = screen.getByLabelText('Organizer secret')
    await waitFor(() => expect(secret).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an empty secret with an accessible validation error and keeps focus on the field', async () => {
    const user = userEvent.setup()
    await mountLogin()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    const secret = screen.getByLabelText('Organizer secret')
    expect(secret).toHaveAttribute('aria-invalid', 'true')
    expect(secret).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits the secret to POST /api/admin/session and surfaces the 401 error without leaking the secret', async () => {
    const user = userEvent.setup()
    fetchHandler = () =>
      jsonResponse({ error: { code: 'unauthorized', message: 'Invalid organizer secret' } }, 401)
    await mountLogin()

    await user.type(screen.getByLabelText('Organizer secret'), 'wrong-secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid organizer secret')
    expect(alert).not.toHaveTextContent('wrong-secret')

    const sessionCall = fetchCall('/api/admin/session', 'POST')
    expect(sessionCall?.body).toBe(JSON.stringify({ secret: 'wrong-secret' }))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('navigates to /admin/events/demo-conf-2026 on success and keeps the session token out of the DOM', async () => {
    const user = userEvent.setup()
    fetchHandler = () =>
      jsonResponse({ expiresAt: EXPIRES_AT }, 200, {
        'set-cookie': `sp_session=${SESSION_TOKEN}; Path=/; HttpOnly`,
      })
    const { router } = await mountLogin()

    await user.type(screen.getByLabelText('Organizer secret'), 'admin-secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/events/demo-conf-2026')
    })
    expect(screen.getByTestId('login-destination')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(SESSION_TOKEN)
    expect(document.body.textContent).not.toContain(EXPIRES_AT)
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.value).not.toContain(SESSION_TOKEN)
      }
    }
  })
})
