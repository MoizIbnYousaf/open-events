import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

import { getFormDraft, listFormVersions, publishForm } from '../../../src/app/api/admin-forms'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'
import BuilderEditor from '../../../src/app/features/builder/BuilderEditor'
import PublishConfirmDialog from '../../../src/app/features/builder/PublishConfirmDialog'
import { routeTree } from '../../../src/app/routeTree.gen'
import { Route as BuilderFormRoute } from '../../../src/app/routes/admin_.events.$slug_.forms.$formId'
import { Route as VersionDetailRoute } from '../../../src/app/routes/admin_.events.$slug_.forms.$formId_.versions.$versionId'

const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
const FORK_VERSION_ID = 'f0000000-0000-4000-8000-000000000003'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const EVENT_SLUG = 'demo-conf-2026'

const DRAFT_DTO = {
  formId: FORM_ID,
  eventId: EVENT_ID,
  versionId: VERSION_ID,
  version: 1,
  status: 'draft',
  contentHash: null,
  publishedAt: null,
  updatedAt: '2026-08-08T09:00:00.000Z',
  pages: [{ id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: 'Introduction' }],
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

const FORK_DTO = {
  ...DRAFT_DTO,
  versionId: FORK_VERSION_ID,
  version: 2,
  updatedAt: '2026-08-08T09:10:00.000Z',
  pages: [{ id: 'fp-1', position: 0, kind: 'welcome', title: 'Welcome', content: 'Introduction' }],
  elements: [
    {
      ...DRAFT_DTO.elements[0],
      id: 'fe-1',
      pageId: 'fp-1',
    },
  ],
}

const PUBLISHED_DTO = {
  ...DRAFT_DTO,
  status: 'published',
  contentHash: 'a'.repeat(64),
  publishedAt: '2026-08-08T09:07:00.000Z',
  updatedAt: '2026-08-08T09:07:00.000Z',
}

const VERSIONS_DTO = [
  {
    id: VERSION_ID,
    formId: FORM_ID,
    version: 1,
    status: 'draft',
    contentHash: null,
    publishedAt: null,
    updatedAt: '2026-08-08T09:00:00.000Z',
  },
]

const VERSIONS_AFTER_PUBLISH_DTO = [
  {
    id: VERSION_ID,
    formId: FORM_ID,
    version: 1,
    status: 'published',
    contentHash: 'a'.repeat(64),
    publishedAt: '2026-08-08T09:07:00.000Z',
    updatedAt: '2026-08-08T09:07:00.000Z',
  },
  {
    id: FORK_VERSION_ID,
    formId: FORM_ID,
    version: 2,
    status: 'draft',
    contentHash: null,
    publishedAt: null,
    updatedAt: '2026-08-08T09:07:00.000Z',
  },
]

const TAXONOMY_DTO = {
  eventId: EVENT_ID,
  items: [
    { id: 't-1', kind: 'track', key: 'talk', label: 'Talk', position: 0 },
    { id: 't-2', kind: 'track', key: 'workshop', label: 'Workshop', position: 1 },
  ],
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

function getRoutePath(route: unknown): string | undefined {
  if (
    typeof route !== 'object' ||
    route === null ||
    !('options' in route) ||
    typeof route.options !== 'object' ||
    route.options === null ||
    !('path' in route.options) ||
    typeof route.options.path !== 'string'
  ) {
    return undefined
  }
  return route.options.path
}

async function mountBuilder() {
  const rootRoute = createRootRoute()
  const builderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/forms/$formId',
    component: BuilderEditor,
  })
  const versionDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/forms/$formId/versions/$versionId',
    component: () => <div data-testid="version-detail-stub">Version detail</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([builderRoute, versionDetailRoute]),
    history: createMemoryHistory({
      initialEntries: [`/admin/events/${EVENT_SLUG}/forms/${FORM_ID}`],
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
  return { router }
}

beforeEach(() => {
  let published = false
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
      return jsonResponse(published ? FORK_DTO : DRAFT_DTO)
    }
    if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`) {
      return jsonResponse(published ? VERSIONS_AFTER_PUBLISH_DTO : VERSIONS_DTO)
    }
    if (
      method === 'GET' &&
      url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${VERSION_ID}`
    ) {
      return jsonResponse(PUBLISHED_DTO)
    }
    if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
      return jsonResponse(TAXONOMY_DTO)
    }
    if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
      return jsonResponse(published ? FORK_DTO : DRAFT_DTO)
    }
    if (method === 'POST' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish`) {
      published = true
      return jsonResponse(PUBLISHED_DTO)
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
  vi.useRealTimers()
  cleanup()
})

describe('builder publish confirmation and version history', () => {
  it('exposes the intended publish/version module surface and route registration', () => {
    expect(BuilderEditor).toBeTypeOf('function')
    expect(PublishConfirmDialog).toBeTypeOf('function')
    expect(getFormDraft).toBeTypeOf('function')
    expect(listFormVersions).toBeTypeOf('function')
    expect(publishForm).toBeTypeOf('function')
    expect(getRoutePath(BuilderFormRoute)).toBe('/admin/events/$slug/forms/$formId')
    expect(getRoutePath(VersionDetailRoute)).toBe(
      '/admin/events/$slug/forms/$formId/versions/$versionId',
    )
  })

  it('requires an explicit confirmation dialog before publishing and never publishes on cancel', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /publish/i }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Version 1')
    expect(dialog).toHaveTextContent(/frozen/i)
    expect(
      fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish`, 'POST'),
    ).toBeUndefined()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish`, 'POST'),
    ).toBeUndefined()
  })

  it('disables the confirm action while publish is pending and announces published on success', async () => {
    const user = userEvent.setup()
    let resolvePublish: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse(DRAFT_DTO)
      }
      if (
        method === 'GET' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`
      ) {
        return jsonResponse(VERSIONS_AFTER_PUBLISH_DTO)
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (
        method === 'POST' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish`
      ) {
        return new Promise<Response>((resolve) => {
          resolvePublish = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /publish/i }))
    const confirmButton = await screen.findByRole('button', { name: /confirm publish/i })
    await user.click(confirmButton)

    expect(confirmButton).toBeDisabled()
    // The in-flight publish is on the control that was pressed AND in a status
    // region: aria-busy on a disabled button is not reliably announced.
    expect(confirmButton).toHaveAttribute('aria-busy', 'true')
    // Scoped to the dialog: the editor behind it owns a status region of its
    // own, which is mounted and silent while the publish runs.
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(/publishing/i)
    resolvePublish?.(jsonResponse(PUBLISHED_DTO))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Published'))
    expect(await screen.findByText('Version 2')).toBeInTheDocument()
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0)
  })

  it('renders a distinct conflict state on publish 409 and never refires the stale publish', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse(DRAFT_DTO)
      }
      if (
        method === 'GET' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`
      ) {
        return jsonResponse(VERSIONS_DTO)
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (
        method === 'POST' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish`
      ) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /publish/i }))
    await user.click(await screen.findByRole('button', { name: /confirm publish/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The draft changed elsewhere — reload to see the latest')
    expect(alert).not.toHaveTextContent('Modified concurrently')
    expect(screen.getByRole('button', { name: /reload latest/i })).toBeInTheDocument()
    const publishCalls = fetchMock.mock.calls.filter(([input, init]) => {
      return (
        requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish` &&
        (init?.method ?? 'GET') === 'POST'
      )
    })
    expect(publishCalls).toHaveLength(1)
  })

  it('does not fire the retry publish until the draft refetch resolves', async () => {
    const user = userEvent.setup()
    let draftGets = 0
    let resolveRefetch: ((response: Response) => void) | undefined
    const publishPostCalls = () =>
      fetchMock.mock.calls.filter(([input, init]) => {
        return (
          requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish` &&
          (init?.method ?? 'GET') === 'POST'
        )
      })
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        draftGets += 1
        if (draftGets > 1) {
          return new Promise<Response>((resolve) => {
            resolveRefetch = resolve
          })
        }
        return jsonResponse(DRAFT_DTO)
      }
      if (
        method === 'GET' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`
      ) {
        return jsonResponse(VERSIONS_DTO)
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (
        method === 'POST' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish`
      ) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /publish/i }))
    await user.click(await screen.findByRole('button', { name: /confirm publish/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The draft changed elsewhere — reload to see the latest')
    expect(alert).not.toHaveTextContent('Modified concurrently')

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: /retry after reload/i }))
      await vi.runAllTimersAsync()
      expect(publishPostCalls()).toHaveLength(1)

      resolveRefetch?.(jsonResponse(DRAFT_DTO))
      for (let i = 0; i < 20; i += 1) {
        await vi.advanceTimersByTimeAsync(0)
        if (publishPostCalls().length === 2) break
      }
      expect(publishPostCalls()).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire the retry publish when the draft refetch fails and keeps the conflict state', async () => {
    const user = userEvent.setup()
    let draftGets = 0
    const publishPostCalls = () =>
      fetchMock.mock.calls.filter(([input, init]) => {
        return (
          requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish` &&
          (init?.method ?? 'GET') === 'POST'
        )
      })
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        draftGets += 1
        if (draftGets > 1) {
          return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
        }
        return jsonResponse(DRAFT_DTO)
      }
      if (
        method === 'GET' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`
      ) {
        return jsonResponse(VERSIONS_DTO)
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (
        method === 'POST' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish`
      ) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /publish/i }))
    await user.click(await screen.findByRole('button', { name: /confirm publish/i }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /retry after reload/i }))

    expect(publishPostCalls()).toHaveLength(1)
    const conflictAlert = await screen.findByRole('alert')
    expect(conflictAlert).toHaveTextContent(
      'The draft changed elsewhere — reload to see the latest',
    )
    expect(conflictAlert).not.toHaveTextContent('Modified concurrently')
    expect(screen.getByRole('button', { name: /retry after reload/i })).toBeInTheDocument()
  })

  it('forks the next save to version+1 after a successful publish', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /publish/i }))
    await user.click(await screen.findByRole('button', { name: /confirm publish/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('Published')

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Talk title')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    const put = fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
    const body = JSON.parse(String(put?.body)) as {
      pages: readonly { id: string }[]
      elements: readonly { id: string; pageId: string }[]
    }
    expect(body.pages[0]?.id).toBe('fp-1')
    expect(body.elements[0]?.id).toBe('fe-1')
    expect(body.elements[0]?.pageId).toBe('fp-1')
  })

  it('keeps version history rows reachable and navigates to the detail URL', async () => {
    const user = userEvent.setup()
    const { router } = await mountBuilder()

    expect(await screen.findByText('Version 1')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /version 1/i }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${VERSION_ID}`,
      )
    })
  })

  it('renders the version detail through the real generated router read-only with labels only', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: [`/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${VERSION_ID}`],
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

    expect(await screen.findByText('Title')).toBeInTheDocument()
    expect(screen.queryByText('title')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument()
    const renderedText = document.body.textContent ?? ''
    expect(renderedText).not.toContain('a'.repeat(64))
    expect(renderedText).not.toContain(FORM_ID)
    expect(renderedText).not.toContain(VERSION_ID)
    expect(renderedText).not.toContain('Modified concurrently')
  })

  it('renders no internal ids, contentHash, or raw server messages on the builder', async () => {
    await mountBuilder()

    expect(await screen.findByDisplayValue('Title')).toBeInTheDocument()
    const renderedText = document.body.textContent ?? ''
    expect(renderedText).not.toContain(FORM_ID)
    expect(renderedText).not.toContain(VERSION_ID)
    expect(renderedText).not.toContain('a'.repeat(64))
    expect(renderedText).not.toContain('Modified concurrently')
  })

  it('renders the denied state when the version detail 404s', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (
        method === 'GET' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${VERSION_ID}`
      ) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: [`/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${VERSION_ID}`],
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

    expect(await screen.findByText('Not found')).toBeInTheDocument()
    expect(screen.getByText('This page could not be found.')).toBeInTheDocument()
    expect(screen.queryByText('Access forbidden')).not.toBeInTheDocument()
  })

  it('confirms dirty navigation and arms the beforeunload guard only while dirty', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Dirty title')

    expect(dispatchBeforeUnload().defaultPrevented).toBe(true)
    await user.click(screen.getByRole('link', { name: /version 1/i }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(/unsaved changes/i)
    expect(screen.getByRole('button', { name: /stay/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /stay/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false)
  })
})
