import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { routeTree } from '../../../src/app/routeTree.gen'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'

// `/start` is a redirect target: it is where a speaker lands from a magic
// link, and it is the only surface that will send them a new one. Nothing in
// the tree used to point at it, so a speaker who closed that email could reach
// it only by typing the URL. The landing page is the one place a reader
// arrives with no session and no link, so the way back in has to be there —
// and it has to survive every restyle of that page, which is what this file
// holds.

const EVENT_DTO = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: 'demo-conf-2026',
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
  websiteUrl: 'https://example.test/demo-conf-2026',
  organizerContact: 'programme@example.test',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

/** The landing page with the event resolved, and with it never resolving. */
function stubFetch(eventBody: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.startsWith('/api/events/')) {
        return Promise.resolve(jsonResponse(eventBody, status))
      }
      return Promise.resolve(
        jsonResponse({ error: { code: 'unauthorized', message: 'no session' } }, 401),
      )
    }),
  )
}

async function mountLanding() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  stubFetch(EVENT_DTO)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('landing page sign-in link', () => {
  it('routes "Email me a sign-in link" to /start', async () => {
    await mountLanding()

    const startLink = await screen.findByRole('link', { name: /email me a sign-in link/i })
    expect(startLink).toHaveAttribute('href', '/start')
  })

  it('keeps the link reachable while the event is still loading', async () => {
    // A promise that never settles: the landing page holds its skeleton, and
    // the way in must not be behind it.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    )
    await mountLanding()

    expect(await screen.findByLabelText('Loading event status')).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('link', { name: /email me a sign-in link/i })).toHaveAttribute(
      'href',
      '/start',
    )
  })

  // The front door is the first screen anyone sees, so the grammar it teaches
  // has to be the grammar every later screen uses: the live state takes the
  // tinted face, everything that is not the live state takes the quiet one, and
  // all of them carry the state marker. These two were inverted — published
  // rendered neutral while draft rendered tinted — which taught the opposite of
  // what the agenda, the form versions, the readiness rows and the rounds say.
  it.each([
    ['published', 'Published', 'secondary'],
    ['draft', 'Draft', 'outline'],
    ['archived', 'Archived', 'outline'],
  ])(
    'gives a %s event the lifecycle chip the rest of the product uses',
    async (status, label, variant) => {
      stubFetch({ ...EVENT_DTO, status })
      await mountLanding()

      const chip = await screen.findByText(label, { selector: '[data-slot="badge"]' })
      expect(chip).toHaveAttribute('data-variant', variant)
      // A state chip is told from a value chip by shape, not by tint: this
      // product spends one structural accent and cannot give every state a hue.
      expect(chip).toHaveAttribute('data-dot', '')
    },
  )

  it('keeps the link reachable when no event is configured', async () => {
    stubFetch({ error: { code: 'not_found', message: 'no event' } }, 404)
    await mountLanding()

    await screen.findByRole('heading', { level: 1, name: 'Event not found' })
    expect(screen.getByRole('link', { name: /email me a sign-in link/i })).toHaveAttribute(
      'href',
      '/start',
    )
  })
})
