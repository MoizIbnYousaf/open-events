import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouteComponent,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormDefinitionDto } from '../../../src/application'
import { getPublishedFormDefinition } from '../../../src/app/api/public'
import {
  PublicCfpPage,
  Route as PublicCfpRoute,
} from '../../../src/app/routes/_public/cfp.$eventSlug.$formSlug'
import { PublicStartPage, Route as PublicStartRoute } from '../../../src/app/routes/_public/start'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../../src/app/lib/default-event'

const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'

const PUBLISHED_FORM: FormDefinitionDto = {
  formId: FORM_ID,
  formSlug: FORM_SLUG,
  eventSlug: EVENT_SLUG,
  versionId: VERSION_ID,
  version: 1,
  status: 'published',
  contentHash: 'a'.repeat(64),
  publishedAt: '2026-08-08T09:00:00.000Z',
  opensAt: '2026-01-01T00:00:00.000Z',
  closesAt: '2026-12-31T23:59:59.000Z',
  submissionState: 'open',
  pages: [
    { id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: 'Introduction' },
    { id: 'p-2', position: 1, kind: 'info', title: 'About your proposal', content: '' },
    { id: 'p-3', position: 2, kind: 'review', title: 'Review', content: '' },
    { id: 'p-4', position: 3, kind: 'submit', title: 'Submit', content: '' },
  ],
  elements: [
    {
      id: 'e-1',
      pageId: 'p-2',
      position: 0,
      kind: 'question',
      fieldKey: 'format',
      label: 'Format',
      required: true,
      maxLength: null,
      questionType: 'single_choice',
      options: ['talk', 'workshop'],
    },
    {
      id: 'e-2',
      pageId: 'p-2',
      position: 1,
      kind: 'question',
      fieldKey: 'workshop_details',
      label: 'Workshop details',
      required: false,
      maxLength: null,
      questionType: 'long_text',
      options: [],
    },
    {
      id: 'e-3',
      pageId: 'p-2',
      position: 2,
      kind: 'question',
      fieldKey: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
    {
      id: 'e-4',
      pageId: 'p-2',
      position: 3,
      kind: 'question',
      fieldKey: 'summary',
      label: 'Summary',
      required: false,
      maxLength: null,
      questionType: 'long_text',
      options: [],
    },
    {
      id: 'e-5',
      pageId: 'p-3',
      position: 4,
      kind: 'question',
      fieldKey: 'bio',
      label: 'Bio',
      required: false,
      maxLength: null,
      questionType: 'long_text',
      options: [],
    },
  ],
  conditionRules: [],
}

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

function definitionUrl() {
  return `/api/public/cfp/${EVENT_SLUG}/${FORM_SLUG}`
}

function draftUrl() {
  return `/api/public/draft?formId=${FORM_ID}`
}

function renderPage(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  window.history.replaceState({}, '', '/start')
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

function routeComponent(route: unknown): RouteComponent | undefined {
  if (
    typeof route === 'object' &&
    route !== null &&
    'options' in route &&
    typeof route.options === 'object' &&
    route.options !== null &&
    'component' in route.options
  ) {
    return route.options.component as RouteComponent | undefined
  }
  return undefined
}

describe('public form routes', () => {
  it('registers the start route with PublicStartPage and the CFP route with PublicCfpPage', () => {
    expect(PublicStartPage).toBeTypeOf('function')
    expect(PublicCfpPage).toBeTypeOf('function')
    expect(routeComponent(PublicStartRoute)).toBe(PublicStartPage)
    expect(routeComponent(PublicCfpRoute)).toBe(PublicCfpPage)
  })

  it('mounts PublicStartPage and renders the StartForm surface', async () => {
    const user = userEvent.setup()
    renderPage(<PublicStartPage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Access your workspace' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Speaker access' })).toBeInTheDocument()
    expect(screen.getByText('Request a link to begin your proposal.')).toBeInTheDocument()
    const email = screen.getByLabelText(/email/i)
    expect(email).toBeInTheDocument()
    expect(email).toHaveFocus()
    await user.type(email, 'speaker@example.test')
    expect(email).toHaveValue('speaker@example.test')
  })

  it('gives expired reviewers organizer-issued recovery without offering a proposal link', () => {
    window.history.replaceState({}, '', '/start?access=evaluation')

    renderPage(<PublicStartPage />)

    expect(screen.getByText('Reviewer link expired')).toBeInTheDocument()
    expect(
      screen.getByText(/ask the event organizer to issue a fresh reviewer invitation/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /request a link/i })).not.toBeInTheDocument()
  })

  it('gives expired speakers organizer-issued portal recovery without offering a CFP link', () => {
    window.history.replaceState({}, '', '/start?access=portal')

    renderPage(<PublicStartPage />)

    expect(screen.getByText('Speaker portal link expired')).toBeInTheDocument()
    expect(screen.getByText(/fresh speaker portal invitation/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  it('explains legacy recovery without guessing whether the visitor is a speaker or reviewer', () => {
    window.history.replaceState({}, '', '/start?access=legacy')

    renderPage(<PublicStartPage />)

    expect(screen.getByRole('alert')).toHaveTextContent(/older link no longer identifies its role/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/reviewers must ask the event organizer/i)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })

  it('wires the real route objects to the production pages through a memory router', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === definitionUrl()) {
        return jsonResponse(PUBLISHED_FORM)
      }
      if (method === 'GET' && url === draftUrl()) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const startComponent = routeComponent(PublicStartRoute)
    const cfpComponent = routeComponent(PublicCfpRoute)
    const rootRoute = createRootRoute()
    const startRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/start',
      component: startComponent,
    })
    const cfpRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/cfp/$eventSlug/$formSlug',
      component: cfpComponent,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([startRoute, cfpRoute]),
      history: createMemoryHistory({ initialEntries: [`/start`] }),
    })
    await router.load()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Access your workspace' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(PublicStartRoute).not.toBe(PublicCfpRoute)

    await router.navigate({ to: `/cfp/${EVENT_SLUG}/${FORM_SLUG}` })
    await screen.findByRole('button', { name: /next/i })
    expect(screen.getByRole('listitem', { name: /welcome/i })).toHaveAttribute('aria-current')
  })

  it('renders CfpWizard only after the published definition GET resolves', async () => {
    let resolveDefinition: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === definitionUrl()) {
        return new Promise<Response>((resolve) => {
          resolveDefinition = resolve
        })
      }
      if (method === 'GET' && url === draftUrl()) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage(<PublicCfpPage eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
    const loading = await screen.findByRole('status')
    expect(loading).toBeInTheDocument()
    resolveDefinition?.(jsonResponse(PUBLISHED_FORM))
    expect(await screen.findByRole('button', { name: /next/i })).toBeInTheDocument()
    // The loading sentence is gone; the save bar's own region stays mounted
    // and silent, waiting for a message it can announce from inside the tree.
    for (const region of screen.queryAllByRole('status')) expect(region).toHaveTextContent('')
    expect(screen.getByRole('listitem', { name: /welcome/i })).toHaveAttribute('aria-current')
  })

  it('issues exactly the definition GET and the active-draft GET, both with credentials include, and nothing else', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === definitionUrl()) {
        return jsonResponse(PUBLISHED_FORM)
      }
      if (method === 'GET' && url === draftUrl()) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage(<PublicCfpPage eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    await screen.findByRole('button', { name: /next/i })
    expect(fetchMock.mock.calls.length).toBe(2)
    const definitionCalls = fetchMock.mock.calls.filter(([input, init]) => {
      return requestUrl(input) === definitionUrl() && (init?.method ?? 'GET') === 'GET'
    })
    const draftCalls = fetchMock.mock.calls.filter(([input, init]) => {
      return requestUrl(input) === draftUrl() && (init?.method ?? 'GET') === 'GET'
    })
    expect(definitionCalls).toHaveLength(1)
    expect(definitionCalls[0]?.[1]?.credentials).toBe('include')
    expect(draftCalls).toHaveLength(1)
    expect(draftCalls[0]?.[1]?.credentials).toBe('include')
    expect(
      fetchMock.mock.calls.every(([input, init]) => {
        const url = requestUrl(input)
        const method = init?.method ?? 'GET'
        return method === 'GET' && (url === definitionUrl() || url === draftUrl())
      }),
    ).toBe(true)
  })

  it('maps a 404 definition to a sanitized not-found state without a raw server message', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === definitionUrl()) {
        return jsonResponse({ error: { code: 'not_found', message: 'raw 404 copy' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage(<PublicCfpPage eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('raw 404 copy')
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
  })

  it('offers a pending-aware retry when the definition GET fails, instead of a dead end', async () => {
    const user = userEvent.setup()
    fetchHandler = () => jsonResponse({ error: { code: 'internal', message: 'raw 500 copy' } }, 500)
    renderPage(<PublicCfpPage eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load the call for papers.',
    )
    expect(document.body.textContent ?? '').not.toContain('raw 500 copy')
    const retry = screen.getByRole('button', { name: 'Retry' })

    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === definitionUrl()) return jsonResponse(PUBLISHED_FORM)
      if (method === 'GET' && url === draftUrl()) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await user.click(retry)

    expect(await screen.findByRole('button', { name: /next/i })).toBeInTheDocument()
  })

  it('starts the journey on the one shared seeded slug pair, never a local copy', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      if ((init?.method ?? 'GET') === 'POST' && url === '/api/public/start') {
        return jsonResponse(
          {
            status: 'accepted',
            guidance:
              'Request captured for this demo. Email delivery is not enabled, so no inbox message will arrive.',
          },
          202,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage(<PublicStartPage />)

    await user.type(screen.getByLabelText(/email/i), 'speaker@example.test')
    await user.click(screen.getByRole('button', { name: /send|start|link/i }))

    await screen.findByText(/request captured for this demo/i)
    const startCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input) === '/api/public/start' && (init?.method ?? 'GET') === 'POST',
    )
    expect(JSON.parse(String(startCall?.[1]?.body ?? '{}'))).toMatchObject({
      eventSlug: DEFAULT_EVENT_SLUG,
      formSlug: DEFAULT_FORM_SLUG,
    })
  })

  it('getPublishedFormDefinition targets the committed CFP URL via GET with credentials', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === definitionUrl()) {
        return jsonResponse(PUBLISHED_FORM)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await getPublishedFormDefinition(EVENT_SLUG, FORM_SLUG)

    const definitionCalls = fetchMock.mock.calls.filter(([input, init]) => {
      return requestUrl(input) === definitionUrl() && (init?.method ?? 'GET') === 'GET'
    })
    expect(definitionCalls).toHaveLength(1)
    expect(definitionCalls[0]?.[1]?.credentials).toBe('include')
  })
})

describe('public route titles', () => {
  beforeEach(() => {
    document.title = 'Your submissions — Open Events'
  })

  it('titles the sign-in step instead of keeping the previous page title', async () => {
    renderPage(<PublicStartPage />)

    await screen.findByRole('heading', { level: 1 })
    expect(document.title).toBe('Start — Open Events')
  })

  it('titles the call for papers in every state the URL can reach', async () => {
    // Not found: no published call for papers behind this slug pair.
    fetchHandler = (url) =>
      url === definitionUrl()
        ? jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        : jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    renderPage(<PublicCfpPage eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument()
    expect(document.title).toBe('Call for papers — Open Events')

    cleanup()
    document.title = 'Your submissions — Open Events'

    // The wizard itself.
    fetchHandler = (url) => {
      if (url === definitionUrl()) return jsonResponse(PUBLISHED_FORM)
      if (url === draftUrl()) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderPage(<PublicCfpPage eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Call for papers' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Call for papers — Open Events')
  })
})
