import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DeniedState,
  ExpiredSessionState,
  ForbiddenState,
} from '../../../src/app/features/admin/AdminStates'
import { routeTree } from '../../../src/app/routeTree.gen'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'

const EVENT_SLUG = 'demo-conf-2026'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
const SUBMISSION_ID = 'submission-1'

const EVENT_DTO = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: EVENT_SLUG,
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
  websiteUrl: 'https://example.test/demo-conf-2026',
  organizerContact: 'programme@example.test',
}

const EVENT_CONFIG_DTO = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: EVENT_SLUG,
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
  websiteUrl: 'https://example.test/demo-conf-2026',
  organizerContact: 'programme@example.test',
}

const TAXONOMY_DTO = {
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  items: [],
}

const SUBMISSION_LIST_ITEM = {
  id: SUBMISSION_ID,
  title: 'My talk',
  status: 'pending',
  formId: FORM_ID,
  formSlug: 'cfp',
  version: 1,
  routing: null,
  primarySpeaker: {
    contactId: 'contact-1',
    name: 'Speaker A',
    email: 'speaker.a@example.test',
    role: 'primary',
    position: 0,
  },
  coSpeakerCount: 0,
  decision: 'pending',
  createdAt: '2026-08-08T12:00:00.000Z',
  submittedAt: '2026-08-08T12:00:00.000Z',
}

const SUBMISSION_DETAIL = {
  id: SUBMISSION_ID,
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  formId: FORM_ID,
  formSlug: 'cfp',
  versionId: VERSION_ID,
  version: 1,
  status: 'pending',
  title: 'My talk',
  answers: { title: 'My talk', format: 'talk' },
  routing: null,
  contributors: [
    {
      contactId: 'contact-1',
      name: 'Speaker A',
      email: 'speaker.a@example.test',
      role: 'primary',
      position: 0,
    },
  ],
  createdAt: '2026-08-08T12:00:00.000Z',
  submittedAt: '2026-08-08T12:00:00.000Z',
  editable: true,
  contentStatus: 'approved',
}

const FORM_VERSION_DETAIL = {
  formId: FORM_ID,
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  versionId: VERSION_ID,
  version: 1,
  status: 'draft',
  contentHash: null,
  publishedAt: null,
  updatedAt: '2026-08-08T09:00:00.000Z',
  pages: [{ id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: '' }],
  elements: [
    {
      id: 'e-1',
      pageId: 'p-1',
      position: 0,
      kind: 'question',
      fieldKey: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
  ],
  conditionRules: [],
  routingRules: [],
}

const BUILDER_DRAFT_DTO = {
  formId: FORM_ID,
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  versionId: VERSION_ID,
  version: 1,
  status: 'draft',
  contentHash: null,
  publishedAt: null,
  updatedAt: '2026-08-08T09:00:00.000Z',
  pages: [{ id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: '' }],
  elements: [
    {
      id: 'e-1',
      pageId: 'p-1',
      position: 0,
      kind: 'question',
      fieldKey: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
  ],
  conditionRules: [],
  routingRules: [],
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

async function mountAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
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
  return { queryClient, router }
}

type HomeState = 'loading' | 'error' | 'empty' | 'ready'

// Exercise the real home route against each event-loading state. The empty
// state is represented by the API's 404 response.
async function mountHome(state: HomeState) {
  if (state === 'loading') {
    fetchHandler = () => new Promise<Response>(() => undefined)
  } else if (state === 'error') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/events/${EVENT_SLUG}`) {
        return jsonResponse(
          { error: { code: 'internal', message: 'server exploded raw copy' } },
          500,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else if (state === 'empty') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/events/${EVENT_SLUG}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/events/${EVENT_SLUG}`) {
        return jsonResponse(EVENT_DTO)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  }
  await mountAt('/')
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === `/api/events/${EVENT_SLUG}`) {
      return jsonResponse(EVENT_DTO)
    }
    if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}`) {
      return jsonResponse(EVENT_CONFIG_DTO)
    }
    if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/forms`) {
      return jsonResponse([])
    }
    if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
      return jsonResponse(TAXONOMY_DTO)
    }
    if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/submissions`) {
      return jsonResponse([SUBMISSION_LIST_ITEM])
    }
    if (
      method === 'GET' &&
      url === `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`
    ) {
      return jsonResponse(SUBMISSION_DETAIL)
    }
    if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
      return jsonResponse(BUILDER_DRAFT_DTO)
    }
    if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`) {
      return jsonResponse([])
    }
    if (
      method === 'GET' &&
      url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${VERSION_ID}`
    ) {
      return jsonResponse(FORM_VERSION_DETAIL)
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

describe('admin shell', () => {
  it('renders the brand as header text, not as a heading', async () => {
    await mountAt('/')

    expect(await screen.findByText('Open Events')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Open Events' })).not.toBeInTheDocument()
  })

  it('gives the main content region id="main" a tabindex of -1', async () => {
    await mountAt('/')

    await screen.findByText('Open Events')
    const main = document.getElementById('main')
    expect(main).not.toBeNull()
    expect(main).toHaveAttribute('tabindex', '-1')
  })

  it.each([
    ['/', 'Run the whole programme in one place.'],
    ['/admin', 'Admin sign in'],
    [`/admin/events/${EVENT_SLUG}`, 'Event settings'],
    [`/admin/events/${EVENT_SLUG}/taxonomies`, 'Taxonomies'],
    [`/admin/events/${EVENT_SLUG}/submissions`, 'Submissions'],
    [`/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`, 'My talk'],
    [`/admin/events/demo-conf-2026/forms/${FORM_ID}`, 'Form builder'],
    [`/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${VERSION_ID}`, 'Version 1'],
  ] as const)('renders exactly one page-owned h1 on %s (never the brand)', async (path, title) => {
    await mountAt(path)

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(title)
    expect(headings[0]).not.toHaveTextContent('Open Events')
  })

  it('renders exactly one page-owned h1 in the home error state (Could not load DemoConf 2026)', async () => {
    await mountHome('error')

    await screen.findByRole('alert')
    const h1s = screen.queryAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(screen.getAllByRole('heading')[0]?.tagName).toBe('H1')
    expect(h1s[0]).toHaveTextContent('Could not load DemoConf 2026')
    expect(h1s[0]).not.toHaveTextContent('Open Events')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/failed to load event/i)
    expect(alert).not.toHaveTextContent('server exploded raw copy')
    expect(document.body.textContent ?? '').not.toContain('server exploded raw copy')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('renders exactly one page-owned h1 in the home empty state (Event not found)', async () => {
    await mountHome('empty')

    await screen.findByText('Event not found')
    const h1s = screen.queryAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(screen.getAllByRole('heading')[0]?.tagName).toBe('H1')
    expect(h1s[0]).toHaveTextContent('Event not found')
    expect(h1s[0]).not.toHaveTextContent('Open Events')
    expect(screen.getByRole('status')).toHaveTextContent(/no event named democonf 2026/i)
  })

  it('renders exactly one page-owned h1 in the home ready state (event name)', async () => {
    await mountHome('ready')

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Run the whole programme in one place.',
      }),
    ).toBeInTheDocument()
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(screen.getAllByRole('heading')[0]?.tagName).toBe('H1')
    expect(h1s[0]).toHaveTextContent('Run the whole programme in one place.')
    expect(h1s[0]).not.toHaveTextContent('Open Events')
    expect(document.body.textContent ?? '').toMatch(/DemoConf 2026/i)
  })

  it('keeps the home loading state heading-free (zero h1s, aria-busy skeleton)', async () => {
    await mountHome('loading')

    const busySkeleton = await screen.findByLabelText('Loading event status')
    expect(busySkeleton).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
  })

  it('pins the rail to the content scroller instead of letting it scroll away', async () => {
    await mountAt(`/admin/events/${EVENT_SLUG}`)

    // jsdom has no layout, so the scroll itself is measured in a browser. What
    // is pinned here is the geometry the measurement came down to. The rail
    // declared `lg:sticky` all along and still travelled the full scroll
    // distance, for two reasons, and BOTH are asserted:
    //  - the grid is a flex item of the `#main` scroller, and without
    //    `shrink-0` flex shrinking clamped its BOX to the scrollport height
    //    while its row ran the length of the page, leaving a sticky child no
    //    room at all to move inside its containing block;
    //  - the panel's height subtracted the toolbar but not the toolbar's 1px
    //    bottom border, so it was one pixel taller than the scrollport and
    //    could never satisfy `top: 0`.
    const nav = await screen.findByRole('navigation', { name: 'Event' })
    const rail = nav.parentElement
    const grid = rail?.parentElement
    expect(rail?.className).toContain('lg:sticky')
    expect(rail?.className).toContain('lg:top-0')
    expect(rail?.className).toContain('lg:h-[calc(100svh-var(--navbar-height)-1px)]')
    expect(grid?.className).toContain('min-h-full')
    expect(grid?.className).toContain('shrink-0')
    expect(document.getElementById('main')?.contains(nav)).toBe(true)
  })

  it('lets the keyboard bypass the rail from the skip-link target', async () => {
    const user = userEvent.setup()
    await mountAt(`/admin/events/${EVENT_SLUG}`)

    const nav = await screen.findByRole('navigation', { name: 'Event' })
    const main = document.getElementById('main')
    // The site skip link lands on `#main`, and the whole rail is rendered
    // inside it — so "skip to content" used to leave the reader at the top of
    // the six destination links they had just asked to skip.
    expect(main?.contains(nav)).toBe(true)

    main?.focus()
    await user.tab()
    const skip = screen.getByRole('link', { name: 'Skip navigation' })
    expect(skip).toHaveFocus()

    const target = document.getElementById(skip.getAttribute('href')?.slice(1) ?? '')
    expect(target).not.toBeNull()
    expect(target).toHaveAttribute('tabindex', '-1')
    expect(target?.contains(nav)).toBe(false)
    expect(target?.contains(screen.getByRole('heading', { level: 1 }))).toBe(true)
  })

  it.each([
    ['ForbiddenState', ForbiddenState],
    ['DeniedState', DeniedState],
  ] as const)('closes the %s dead end with the designed state grammar', async (_name, State) => {
    render(
      <ThemeProvider>
        <State />
      </ThemeProvider>,
    )

    // C0 §8: a dead end reachable from the product's own links has to be
    // closed. These two were a title and a sentence in a box with nothing to
    // press, beside a router 404 that was a fully designed card — same product,
    // same moment, two faces. They now carry the same three things it does.
    expect(document.querySelector('[data-slot="paper-stack"]')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Go to the start' })).toHaveAttribute('href', '/')
    expect(screen.getByText(/to search every screen by name/i)).toBeInTheDocument()
    // The recovery surface renders with no router in scope, deliberately.
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it.each([
    ['ExpiredSessionState', 'Session expired'],
    ['ForbiddenState', 'Access forbidden'],
    ['DeniedState', 'Not found'],
  ] as const)('renders exactly one h1 with the %s title, never the brand', async (_name, title) => {
    const rootRoute = createRootRoute({
      component: () => (
        <div className="flex min-h-svh flex-col">
          <header>
            <span className="text-base font-semibold tracking-tight">Open Events</span>
          </header>
          <main id="main">
            <Outlet />
          </main>
        </div>
      ),
    })
    const denialRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/denial/$kind',
      component: DenialScreen,
    })
    function DenialScreen() {
      const { kind } = useParams({ from: denialRoute.id })
      if (kind === 'expired') return <ExpiredSessionState onLogin={() => undefined} />
      if (kind === 'forbidden') return <ForbiddenState />
      return <DeniedState />
    }
    const router = createRouter({
      routeTree: rootRoute.addChildren([denialRoute]),
      history: createMemoryHistory({
        initialEntries: [
          `/denial/${_name === 'ExpiredSessionState' ? 'expired' : _name === 'ForbiddenState' ? 'forbidden' : 'denied'}`,
        ],
      }),
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

    expect(await screen.findByText(title)).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(title)
    expect(headings[0]).not.toHaveTextContent('Open Events')
  })
})
