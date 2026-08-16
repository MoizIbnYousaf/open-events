import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { routeTree } from '../../../src/app/routeTree.gen'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'
import { ORBY_NAME } from '../../../src/domain/support'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

let lastPost: { url: string; body: unknown } | null

beforeEach(() => {
  lastPost = null
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url.startsWith('/api/support-chat') && init?.method === 'POST') {
        lastPost = { url, body: JSON.parse(String(init.body ?? '{}')) }
        return Promise.resolve(
          jsonResponse({
            role: 'guest',
            needsIdentity: false,
            guestToken: null,
            chat: {
              id: 'chat-1',
              unreadCount: 0,
              userName: 'Ada',
              userEmail: 'ada@example.test',
              messages: [],
            },
          }),
        )
      }
      if (url.startsWith('/api/support-chat')) {
        return Promise.resolve(
          jsonResponse({ role: 'none', needsIdentity: true, chat: null, guestToken: null }),
        )
      }
      if (url.startsWith('/api/events/')) {
        return Promise.resolve(
          jsonResponse({
            id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
            slug: 'demo-conf-2026',
            name: 'DemoConf 2026',
            timezone: 'Europe/Berlin',
            status: 'draft',
            startsAt: null,
            endsAt: null,
          }),
        )
      }
      return Promise.resolve(jsonResponse({ error: { code: 'internal' } }, 500))
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function mountAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  render(
    <ThemeProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('Orby widget', () => {
  it('opens on the public site and starts a conversation', async () => {
    const user = userEvent.setup()
    await mountAt('/')
    await user.click(await screen.findByRole('button', { name: `Chat with ${ORBY_NAME}` }))
    await user.type(screen.getByLabelText('Name'), 'Ada')
    await user.type(screen.getByLabelText('Email'), 'ada@example.test')
    await user.click(screen.getByRole('button', { name: 'Start chat' }))
    await waitFor(() => {
      expect(lastPost?.body).toMatchObject({
        name: 'Ada',
        email: 'ada@example.test',
      })
    })
    expect(
      await screen.findByText(`Say hello. ${ORBY_NAME} will pick this up.`),
    ).toBeInTheDocument()
  })

  it('stays off the organizer desk', async () => {
    await mountAt('/admin')
    expect(screen.queryByRole('button', { name: `Chat with ${ORBY_NAME}` })).toBeNull()
  })
})
