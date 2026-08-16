import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
import EventConfig from '../../../src/app/features/admin/EventConfig'

const EVENT_CONFIG_DTO = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: 'demo-conf-2026',
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
  websiteUrl: 'https://example.test/demo-conf-2026',
  organizerContact: 'programme@example.test',
  venue: 'DemoConf Convention Center, Berlin',
  eventType: 'conference',
}

const BUILDER_FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const FORMS_DTO = [
  {
    formId: BUILDER_FORM_ID,
    eventId: EVENT_CONFIG_DTO.id,
    slug: 'cfp',
    status: 'published',
    publishedVersionId: 'f0000000-0000-4000-8000-000000000002',
  },
]

const FORBIDDEN_HIT_AREA_TOKEN =
  /^(hidden|contents|!min-h-|!min-w-|!max-h-|!max-w-|min-h-\[|min-w-\[|min-h-\(|min-w-\(|max-h-|max-w-)/

/**
 * Strips Tailwind variant prefixes by removing everything up to and including
 * the LAST variant colon that sits outside bracket/paren nesting, so
 * `sm:min-h-[foo:bar]` normalizes to `min-h-[foo:bar]` and arbitrary values
 * containing colons are preserved.
 */
function stripVariants(token: string): string {
  let depth = 0
  let lastVariantColon = -1
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i]
    if (char === '[' || char === '(') {
      depth += 1
    } else if (char === ']' || char === ')') {
      depth = Math.max(0, depth - 1)
    } else if (char === ':' && depth === 0) {
      lastVariantColon = i
    }
  }
  return lastVariantColon === -1 ? token : token.slice(lastVariantColon + 1)
}

/**
 * Rejects a class token when the raw token OR its variant-stripped base
 * matches a forbidden hit-area contract (so `hover:hidden`,
 * `sm:min-h-[foo:bar]`, and `!max-h-4` are rejected while `overflow-hidden`
 * stays allowed).
 */
function isForbiddenHitAreaToken(token: string): boolean {
  return FORBIDDEN_HIT_AREA_TOKEN.test(token) || FORBIDDEN_HIT_AREA_TOKEN.test(stripVariants(token))
}

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>

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

function dispatchBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

async function mountConfig() {
  const rootRoute = createRootRoute()
  const configRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug',
    component: EventConfig,
  })
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    component: () => <div data-testid="login-redirect">Admin login</div>,
  })
  const builderStubRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/forms/$formId',
    component: () => <div data-testid="builder-stub">Builder</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([configRoute, loginRoute, builderStubRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin/events/demo-conf-2026'] }),
  })
  await router.load()
  const queryClient = createQueryClient()
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, container }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
      return jsonResponse(EVENT_CONFIG_DTO)
    }
    if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
      return jsonResponse(FORMS_DTO)
    }
    if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/confirmation-template') {
      return jsonResponse({
        subject: 'Your submission was received',
        body: 'Open Events: your submission "{{title}}" was received ({{submissionId}}).',
      })
    }
    if (method === 'PATCH' && url === '/api/admin/events/demo-conf-2026') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ ...EVENT_CONFIG_DTO, ...body })
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('event config screen', () => {
  it('loads and binds the seeded event config', async () => {
    await mountConfig()

    expect(await screen.findByLabelText('Venue')).toHaveValue('DemoConf Convention Center, Berlin')
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Berlin')
    expect(screen.getByLabelText('Website')).toHaveValue('https://example.test/demo-conf-2026')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('opens with a compact event overview and direct paths into the programme desks', async () => {
    await mountConfig()

    const overview = await screen.findByRole('region', { name: 'Event overview' })
    expect(overview).toHaveTextContent('Draft')
    expect(overview).toHaveTextContent('1 published form')
    expect(overview).toHaveTextContent('Call for papers')
    expect(within(overview).getByRole('link', { name: 'Review submissions' })).toHaveAttribute(
      'href',
      '/admin/events/demo-conf-2026/submissions',
    )
    expect(within(overview).getByRole('link', { name: 'Track speaker readiness' })).toHaveAttribute(
      'href',
      '/admin/events/demo-conf-2026/readiness',
    )
    expect(within(overview).getByRole('link', { name: 'Build the agenda' })).toHaveAttribute(
      'href',
      '/admin/events/demo-conf-2026/agenda',
    )
  })

  // TA6-S2: two levels of structure need two spacing signals. At 12px between
  // the cards and 12px between the rows inside them, five bordered cards read
  // as one undifferentiated column — and the last one used to sit flush
  // against the bottom of the viewport, which reads as a page cut off rather
  // than a page that ended.
  it('breathes wider between its sections than inside them, and ends on a floor', async () => {
    await mountConfig()
    await screen.findByLabelText('Venue')

    const card = screen.getByLabelText('Venue').closest('[data-slot="card"]')
    const stack = card?.closest('.max-w-3xl')
    expect(stack).not.toBeNull()
    const tokens = (stack?.className ?? '').split(/\s+/)
    // Outer rhythm, at both widths, above the p-3/gap-3 card anatomy.
    expect(tokens).toContain('gap-4')
    expect(tokens).toContain('lg:gap-6')
    expect(tokens).not.toContain('gap-3')
    // The floor under the last card.
    expect(tokens).toContain('pb-20')
    // The reading measure is unchanged; this is a vertical change only.
    expect(tokens).toContain('max-w-3xl')
  })

  it('saves a partial edit with only the changed field and announces Saved', async () => {
    const user = userEvent.setup()
    await mountConfig()

    const venue = await screen.findByLabelText('Venue')
    await user.clear(venue)
    await user.type(venue, 'Hamburg Messe')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status', { name: 'Event settings status' })).toHaveTextContent(
      'Saved',
    )
    const patch = fetchCall('/api/admin/events/demo-conf-2026', 'PATCH')
    expect(patch).toBeDefined()
    expect(JSON.parse(String(patch?.body))).toEqual({ venue: 'Hamburg Messe' })
  })

  it('rejects an empty timezone with validation-failed and focuses the invalid field', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return jsonResponse([])
      }
      if (method === 'PATCH' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(
          { error: { code: 'validation_failed', message: 'Validation failed' } },
          400,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    const timezone = await screen.findByLabelText('Timezone')
    await user.clear(timezone)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    const invalidTimezone = screen.getByLabelText('Timezone')
    expect(invalidTimezone).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(invalidTimezone).toHaveFocus())
  })

  it('redirects to /admin when the session expires during save', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return jsonResponse([])
      }
      if (method === 'PATCH' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { router } = await mountConfig()

    const venue = await screen.findByLabelText('Venue')
    await user.clear(venue)
    await user.type(venue, 'Hamburg')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin')
    })
    expect(screen.getByTestId('login-redirect')).toBeInTheDocument()
  })

  it('renders a distinct forbidden state on a 403 load', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    expect(await screen.findByText('Access forbidden')).toBeInTheDocument()
    expect(screen.getByText('You do not have permission to view this page.')).toBeInTheDocument()
    expect(screen.queryByText('This page could not be found.')).not.toBeInTheDocument()
  })

  it('renders a distinct denied state on a 404 load', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    expect(await screen.findByText('Not found')).toBeInTheDocument()
    expect(screen.getByText('This page could not be found.')).toBeInTheDocument()
    expect(
      screen.queryByText('You do not have permission to view this page.'),
    ).not.toBeInTheDocument()
  })

  it('rejects an invalid IANA timezone client-side without PATCHing', async () => {
    const user = userEvent.setup()
    await mountConfig()

    const timezone = await screen.findByLabelText('Timezone')
    await user.clear(timezone)
    await user.type(timezone, 'Not/A Timezone')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(fetchCall('/api/admin/events/demo-conf-2026', 'PATCH')).toBeUndefined()
  })

  it('shows a loading state with aria-busy while the config loads', async () => {
    let resolveLoad: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return new Promise<Response>((resolve) => {
          resolveLoad = resolve
        })
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return jsonResponse([])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { container } = await mountConfig()

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    resolveLoad?.(jsonResponse(EVENT_CONFIG_DTO))
    expect(await screen.findByLabelText('Venue')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('shows Saving… and keeps Save disabled while the mutation is pending, then re-enables', async () => {
    const user = userEvent.setup()
    let resolveSave: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return jsonResponse([])
      }
      if (method === 'PATCH' && url === '/api/admin/events/demo-conf-2026') {
        return new Promise<Response>((resolve) => {
          resolveSave = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    const venue = await screen.findByLabelText('Venue')
    await user.clear(venue)
    await user.type(venue, 'Hamburg Messe')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const saveButton = screen.getByRole('button', { name: /saving/i })
    expect(saveButton).toHaveTextContent('Saving…')
    expect(saveButton).toHaveAttribute('aria-disabled', 'true')

    resolveSave?.(jsonResponse({ ...EVENT_CONFIG_DTO, venue: 'Hamburg Messe' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveTextContent('Saving…')
  })

  it('prevents beforeunload while the form is dirty', async () => {
    const user = userEvent.setup()
    await mountConfig()

    const venue = await screen.findByLabelText('Venue')
    await user.clear(venue)
    await user.type(venue, 'Hamburg Messe')

    expect(dispatchBeforeUnload().defaultPrevented).toBe(true)
  })

  it('does not prevent beforeunload after a successful save rebases the form', async () => {
    const user = userEvent.setup()
    await mountConfig()

    const venue = await screen.findByLabelText('Venue')
    await user.clear(venue)
    await user.type(venue, 'Hamburg Messe')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status', { name: 'Event settings status' })).toHaveTextContent(
      'Saved',
    )
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false)
  })

  it('lists the event forms and renders a human-readable builder link per form', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return jsonResponse(FORMS_DTO)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    expect(fetchCall('/api/admin/events/demo-conf-2026/forms', 'GET')).toBeDefined()

    const builderLink = await screen.findByRole('link', { name: 'cfp' })
    expect(builderLink).toHaveAttribute(
      'href',
      '/admin/events/demo-conf-2026/forms/f0000000-0000-4000-8000-000000000001',
    )
    expect(builderLink.textContent).not.toContain(BUILDER_FORM_ID)
    expect(document.body.textContent).not.toContain(BUILDER_FORM_ID)
  })

  it('shows a busy forms region while loading, then clears and shows the loaded state', async () => {
    let resolveForms: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return new Promise<Response>((resolve) => {
          resolveForms = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    await waitFor(() => {
      expect(screen.getByText('Forms')).toBeInTheDocument()
    })
    const formsText = screen.getByText('Forms')
    expect(formsText.closest('[aria-busy="true"]') ?? formsText).toHaveAttribute(
      'aria-busy',
      'true',
    )
    resolveForms?.(jsonResponse(FORMS_DTO))
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'cfp' })).toBeInTheDocument()
    })
    const loadedForms = screen.getByText('Forms')
    expect(loadedForms.closest('[aria-busy="true"]') ?? loadedForms).not.toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('renders a forms-specific polite empty state when the event has no forms', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return jsonResponse([])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    await waitFor(() => {
      expect(fetchCall('/api/admin/events/demo-conf-2026/forms', 'GET')).toBeDefined()
    })
    // Scoped by name: the surface now also announces its loading state, so an
    // unscoped status query would resolve whichever region exists first.
    const empty = await screen.findByRole('status', { name: 'No forms' })
    expect(empty).toHaveTextContent(/no forms/i)
  })

  it('shows a forms error with retry, then clears on successful retry', async () => {
    const user = userEvent.setup()
    let formsFails = true
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return formsFails
          ? jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
          : jsonResponse(FORMS_DTO)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    await waitFor(() => {
      expect(fetchCall('/api/admin/events/demo-conf-2026/forms', 'GET')).toBeDefined()
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/forms/i)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

    formsFails = false
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => {
      const formsCalls = fetchMock.mock.calls.filter(([input, init]) => {
        return (
          requestUrl(input) === '/api/admin/events/demo-conf-2026/forms' &&
          (init?.method ?? 'GET') === 'GET'
        )
      })
      expect(formsCalls).toHaveLength(2)
    })
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'cfp' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('navigates to the builder via the router without a full-page reload', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return jsonResponse(FORMS_DTO)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { router } = await mountConfig()

    const builderLink = await screen.findByRole('link', { name: 'cfp' })
    const locationBefore = window.location.href
    await user.click(builderLink)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/admin/events/demo-conf-2026/forms/${BUILDER_FORM_ID}`,
      )
    })
    await waitFor(() => {
      expect(router.state.location.search).toEqual({})
    })
    expect(router.state.location.searchStr).toBe('')
    expect(window.location.href).toBe(locationBefore)
  })

  it('provides a ≥24×24px hit area on the builder link', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026') {
        return jsonResponse(EVENT_CONFIG_DTO)
      }
      if (method === 'GET' && url === '/api/admin/events/demo-conf-2026/forms') {
        return jsonResponse(FORMS_DTO)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountConfig()

    const builderLink = await screen.findByRole('link', { name: 'cfp' })
    expect(builderLink).toHaveClass('inline-flex', 'min-h-6', 'min-w-6')
    const forbiddenTokens = Array.from(builderLink.classList).filter(isForbiddenHitAreaToken)
    expect(forbiddenTokens).toEqual([])
  })

  it.each([
    ['overflow-hidden', false],
    ['hover:hidden', true],
    ['sm:contents', true],
    ['group-hover:!min-h-4', true],
    ['sm:min-h-[foo:bar]', true],
    ['sm:min-h-[url(http://x)]', true],
    ['[&:hover]:hidden', true],
    ['!max-h-4', true],
    ['sm:!max-h-4', true],
    ['!max-w-[1px]', true],
  ] as const)('forbidden hit-area matcher: %s → rejected=%s', (token, rejected) => {
    expect(isForbiddenHitAreaToken(token)).toBe(rejected)
  })
})
