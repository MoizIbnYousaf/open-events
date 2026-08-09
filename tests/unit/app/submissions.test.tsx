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
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FormVersionDetailDto,
  SubmissionDetailDto,
  SubmissionListItemDto,
} from '../../../src/application'
import SubmissionDetail from '../../../src/app/features/admin/SubmissionDetail'
import SubmissionList from '../../../src/app/features/admin/SubmissionList'

const EVENT_SLUG = 'demo-conf-2026'
const SUBMISSION_ID = 'submission-1'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'

const SUBMISSION_LIST_ITEM: SubmissionListItemDto = {
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
  createdAt: '2026-08-08T12:00:00.000Z',
  submittedAt: '2026-08-08T12:00:00.000Z',
}

const SUBMISSION_DETAIL: SubmissionDetailDto = {
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
}

const FORM_VERSION_DETAIL: FormVersionDetailDto = {
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
    {
      id: 'e-2',
      pageId: 'p-1',
      position: 1,
      kind: 'question',
      fieldKey: 'format',
      label: 'Format',
      required: true,
      maxLength: null,
      questionType: 'single_choice',
      options: ['talk', 'workshop'],
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

function listUrl() {
  return `/api/admin/events/${EVENT_SLUG}/submissions`
}

function detailUrl() {
  return `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`
}

function versionUrl() {
  return `/api/admin/forms/${FORM_ID}/versions/${VERSION_ID}`
}

async function mountList(initialEntry = `/admin/events/${EVENT_SLUG}/submissions`) {
  const rootRoute = createRootRoute()
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions',
    component: SubmissionList,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
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
  return { queryClient, router }
}

async function mountDetail() {
  const rootRoute = createRootRoute()
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions',
    component: SubmissionList,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions/$submissionId',
    component: SubmissionDetail,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, detailRoute]),
    history: createMemoryHistory({
      initialEntries: [`/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`],
    }),
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
  return { queryClient, router }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === listUrl()) {
      return jsonResponse([SUBMISSION_LIST_ITEM])
    }
    if (method === 'GET' && url === detailUrl()) {
      return jsonResponse(SUBMISSION_DETAIL)
    }
    if (method === 'GET' && url === versionUrl()) {
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

describe('organizer submissions', () => {
  it('exposes SubmissionList and SubmissionDetail as functions', () => {
    expect(SubmissionList).toBeTypeOf('function')
    expect(SubmissionDetail).toBeTypeOf('function')
  })

  it('renders the list as a real table with every required column header scoped col and row links', async () => {
    await mountList()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    for (const name of [
      'Title',
      'Status',
      'Primary speaker',
      'Co-speakers',
      'Form/Version',
      'Track/Tags',
      'Submitted',
    ]) {
      const header = screen.getByRole('columnheader', { name })
      expect(header).toHaveAttribute('scope', 'col')
    }

    const rowLink = await screen.findByRole('link', {
      name: /My talk.*pending.*Speaker A/i,
    })
    expect(rowLink).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`,
    )
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('shows aria-busy while the list loads and clears it when data resolves', async () => {
    let resolveList: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) {
        return new Promise<Response>((resolve) => {
          resolveList = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()

    const region = await screen.findByRole('region', { name: /submissions/i })
    expect(region).toHaveAttribute('aria-busy', 'true')

    resolveList?.(jsonResponse([SUBMISSION_LIST_ITEM]))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(region).toHaveAttribute('aria-busy', 'false')
  })

  it('renders a polite empty state with the exact action label', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) {
        return jsonResponse([])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()

    const status = await screen.findByRole('status', { name: /no submissions/i })
    expect(status).toHaveTextContent(/no submissions/i)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('renders an error alert with a retry that issues exactly one list GET', async () => {
    const user = userEvent.setup()
    let fails = true
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) {
        if (fails) {
          fails = false
          return jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500)
        }
        return jsonResponse([SUBMISSION_LIST_ITEM])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unable to load/i)
    expect(alert).not.toHaveTextContent('boom')
    expect(fetchMock.mock.calls.length).toBe(1)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(fetchMock.mock.calls.length).toBe(2)
    const retried = fetchMock.mock.calls[1] as [RequestInfo | URL, RequestInit?] | undefined
    expect(retried).toBeDefined()
    expect(requestUrl(retried?.[0] ?? '')).toBe(listUrl())
    expect(retried?.[1]?.method ?? 'GET').toBe('GET')
  })

  it('renders expired-session for 401 and byte-identical generic denial for 403 and 404', async () => {
    const deniedBodies: string[] = []
    for (const state of [
      { status: 401, code: 'unauthorized' },
      { status: 403, code: 'forbidden' },
      { status: 404, code: 'not_found' },
    ] as const) {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === listUrl()) {
          return jsonResponse({ error: { code: state.code, message: 'server copy' } }, state.status)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      await mountList()

      if (state.status === 401) {
        expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
        expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
      } else {
        expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument()
      }
      const rendered = document.body.textContent ?? ''
      expect(rendered).not.toContain('server copy')
      expect(rendered).not.toContain('My talk')
      expect(rendered).not.toContain('Speaker A')
      expect(rendered).not.toContain('speaker.a@example.test')
      expect(rendered).not.toContain(SUBMISSION_ID)
      if (state.status !== 401) {
        deniedBodies.push(rendered)
      }
      cleanup()
    }
    expect(deniedBodies).toHaveLength(2)
    expect(deniedBodies[0]).toBe(deniedBodies[1])
  })

  it('renders no counters or dashboard summary elements', async () => {
    await mountList()
    await screen.findByRole('table')
    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toMatch(/\d+\s*(submissions?|pending|total)/i)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the detail snapshot with committed labels, version, pending, read-only, and a back link', async () => {
    await mountDetail()

    expect(await screen.findByRole('heading', { name: 'My talk' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText(/version 1/i)).toBeInTheDocument()
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Format')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to submissions/i })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/submissions`,
    )

    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toMatch(/\btitle\b/)
    expect(rendered).not.toMatch(/\bformat\b/)
    expect(rendered).not.toContain(SUBMISSION_ID)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('focuses the route h1 on entry with tabIndex -1 and no control autofocus', async () => {
    await mountDetail()

    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(h1).toHaveAttribute('tabindex', '-1')
    expect(h1).toHaveFocus()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders expired-session for detail 401 and byte-identical generic denial for 403/404', async () => {
    const deniedBodies: string[] = []
    for (const state of [
      { status: 401, code: 'unauthorized' },
      { status: 403, code: 'forbidden' },
      { status: 404, code: 'not_found' },
    ] as const) {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === detailUrl()) {
          return jsonResponse({ error: { code: state.code, message: 'server copy' } }, state.status)
        }
        if (method === 'GET' && url === versionUrl()) {
          return jsonResponse({ error: { code: state.code, message: 'server copy' } }, state.status)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      await mountDetail()

      if (state.status === 401) {
        expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
        expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
      } else {
        expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument()
      }
      const rendered = document.body.textContent ?? ''
      expect(rendered).not.toContain('server copy')
      expect(rendered).not.toContain('My talk')
      expect(rendered).not.toContain('Speaker A')
      expect(rendered).not.toContain('speaker.a@example.test')
      expect(rendered).not.toContain(SUBMISSION_ID)
      if (state.status !== 401) {
        deniedBodies.push(rendered)
      }
      cleanup()
    }
    expect(deniedBodies).toHaveLength(2)
    expect(deniedBodies[0]).toBe(deniedBodies[1])
  })

  it('retries the failed version query when only the form-version GET fails', async () => {
    const user = userEvent.setup()
    let versionFails = true
    let versionGets = 0
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === detailUrl()) {
        return jsonResponse(SUBMISSION_DETAIL)
      }
      if (method === 'GET' && url === versionUrl()) {
        versionGets += 1
        if (versionFails) {
          versionFails = false
          return jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500)
        }
        return jsonResponse(FORM_VERSION_DETAIL)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountDetail()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unable to load/i)
    expect(versionGets).toBe(1)

    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(versionGets).toBe(2)
    expect(await screen.findByText('Title')).toBeInTheDocument()
    expect(await screen.findByText('Format')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('issues the exact committed GET sets per load with no unrelated fetches', async () => {
    await mountList()
    await screen.findByRole('table')
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(listUrl())
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('include')

    cleanup()
    fetchMock.mockClear()
    await mountDetail()
    await screen.findByRole('heading', { level: 1 })
    expect(fetchMock.mock.calls.length).toBe(2)
    const urls = fetchMock.mock.calls.map(([input, init]) => ({
      url: requestUrl(input),
      method: init?.method ?? 'GET',
      credentials: init?.credentials,
    }))
    expect(urls).toEqual([
      { url: detailUrl(), method: 'GET', credentials: 'include' },
      { url: versionUrl(), method: 'GET', credentials: 'include' },
    ])
  })
})
