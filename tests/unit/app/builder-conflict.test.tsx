import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

import type { FormVersionDetailDto, SaveFormDraftInput } from '../../../src/application'
import { getFormDraft, updateFormDraft } from '../../../src/app/api/admin-forms'
import BuilderEditor from '../../../src/app/features/builder/BuilderEditor'
import RoutingRuleEditor from '../../../src/app/features/builder/RoutingRuleEditor'
import TaxonomyPicker from '../../../src/app/features/builder/TaxonomyPicker'
import { adminFormQueryKeys } from '../../../src/app/queries/admin-forms'

const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const EVENT_SLUG = 'demo-conf-2026'

const DRAFT_DTO: FormVersionDetailDto = {
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
    {
      id: 'e-2',
      pageId: 'p-1',
      position: 1,
      kind: 'question',
      fieldKey: 'abstract',
      label: 'Abstract',
      required: false,
      maxLength: null,
      questionType: 'long_text',
      options: [],
    },
  ],
  conditionRules: [
    {
      id: 'r-1',
      elementId: 'e-2',
      effect: 'show',
      position: 0,
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'title', value: 'draft' }],
        },
      ],
    },
  ],
  routingRules: [
    {
      id: 'rr-1',
      position: 0,
      condition: {
        groups: [{ conditions: [{ operator: 'eq', operandKey: 'title', value: 'draft' }] }],
      },
      actionKind: 'assign_track',
      actionTarget: 'talk',
    },
  ],
}

const TAXONOMY_DTO = {
  eventId: EVENT_ID,
  items: [
    { id: 't-1', kind: 'track', key: 'talk', label: 'Talk', position: 0 },
    { id: 't-2', kind: 'track', key: 'workshop', label: 'Workshop', position: 1 },
  ],
}

type DraftPayload = SaveFormDraftInput

function reissueContent(body: DraftPayload): FormVersionDetailDto {
  const elementIds = new Map(
    body.elements.map((element, index) => [element.id, `el-${index}`] as const),
  )
  return {
    ...DRAFT_DTO,
    updatedAt: '2026-08-08T09:05:00.000Z',
    pages: body.pages.map((page, index) => ({
      id: `pg-${index}`,
      position: page.position,
      kind: page.kind,
      title: page.title,
      content: page.content,
    })),
    elements: body.elements.map((element, index) => ({
      id: `el-${index}`,
      pageId: element.pageId,
      position: element.position,
      kind: element.kind,
      fieldKey: element.fieldKey,
      label: element.label,
      required: element.required,
      maxLength: element.maxLength,
      questionType: element.questionType,
      options: element.options,
    })),
    conditionRules: body.conditionRules.map((rule, index) => ({
      id: `rl-${index}`,
      elementId: elementIds.get(rule.elementId) ?? '',
      effect: rule.effect,
      position: rule.position,
      groups: rule.groups,
    })),
    routingRules: body.routingRules.map((rule, index) => ({
      id: `rr-${index}`,
      position: rule.position,
      condition: rule.condition,
      actionKind: rule.actionKind,
      actionTarget: rule.actionTarget,
    })),
  }
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

function fetchCalls(url: string, method: string): RequestInit[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => {
      return requestUrl(input) === url && (init?.method ?? 'GET') === method
    })
    .map(([, init]) => init)
    .filter((init): init is RequestInit => init !== undefined)
}

async function mountBuilder() {
  const rootRoute = createRootRoute()
  const builderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/forms/$formId',
    component: BuilderEditor,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([builderRoute]),
    history: createMemoryHistory({
      initialEntries: [`/admin/events/${EVENT_SLUG}/forms/${FORM_ID}`],
    }),
  })
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
      return jsonResponse(DRAFT_DTO)
    }
    if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`) {
      return jsonResponse([])
    }
    if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
      return jsonResponse(TAXONOMY_DTO)
    }
    if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
      const body = JSON.parse(String(init?.body)) as DraftPayload
      return jsonResponse(reissueContent(body))
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

describe('builder draft conflict handling and payload contract', () => {
  it('exposes the intended conflict/payload module surface', () => {
    expect(BuilderEditor).toBeTypeOf('function')
    expect(RoutingRuleEditor).toBeTypeOf('function')
    expect(TaxonomyPicker).toBeTypeOf('function')
    expect(getFormDraft).toBeTypeOf('function')
    expect(updateFormDraft).toBeTypeOf('function')
  })

  it('sends a full-replace PUT with only the frozen SaveFormDraftInput keys', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /save/i }))
    const put = fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
    const body = JSON.parse(String(put?.body)) as {
      pages: readonly { id: string }[]
      elements: readonly { id: string; pageId: string }[]
      conditionRules: readonly { id: string; position: number }[]
      routingRules: readonly { id: string }[]
    }
    expect(Object.keys(body).sort()).toEqual([
      'conditionRules',
      'elements',
      'pages',
      'routingRules',
    ])
    expect(body.pages.map((page) => page.id)).toEqual(['p-1'])
    expect(body.elements.map((element) => element.id)).toEqual(['e-1', 'e-2'])
    expect(body.elements[0]?.pageId).toBe('p-1')
    expect(body.conditionRules.map((rule) => rule.id)).toEqual(['r-1'])
    expect(body.conditionRules[0]?.position).toBe(0)
    expect(body.routingRules.map((rule) => rule.id)).toEqual(['rr-1'])
  })

  it('replaces the model with server-reissued ids and sends zero stale references next', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /save/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    await user.click(screen.getByRole('button', { name: /save/i }))

    const putBodies = fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
    expect(putBodies).toHaveLength(2)
    const secondPut = putBodies[1]
    const serialized = String(secondPut?.body)
    const secondBody = JSON.parse(serialized) as {
      pages: readonly { id: string }[]
      elements: readonly { id: string }[]
      conditionRules: readonly { id: string }[]
      routingRules: readonly { id: string }[]
    }
    expect(secondBody.pages[0]?.id).toBe('pg-0')
    expect(secondBody.elements[0]?.id).toBe('el-0')
    expect(serialized).not.toContain('p-1')
    expect(serialized).not.toContain('e-1')
    expect(serialized).not.toContain('r-1')
    expect(serialized).not.toContain('rr-1')
  })

  it('renders a distinct conflict state on 409 with reload/discard/retry and never auto-retries', async () => {
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
        return jsonResponse([])
      }
      if (method === 'GET' && url.endsWith('/taxonomies')) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')
    await user.click(screen.getByRole('button', { name: /save/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The draft changed elsewhere — reload to see the latest')
    expect(alert).not.toHaveTextContent('Modified concurrently')
    expect(screen.getByRole('button', { name: /reload latest/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /discard my changes/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry after reload/i })).toBeInTheDocument()
    expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Edited title')
    const putCalls = fetchMock.mock.calls.filter(([input, init]) => {
      return (
        requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft` &&
        (init?.method ?? 'GET') === 'PUT'
      )
    })
    expect(putCalls).toHaveLength(1)
  })

  it('retry after reload retains the edited label in the retried PUT', async () => {
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
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')
    await user.click(screen.getByRole('button', { name: /save/i }))

    const conflictAlert = await screen.findByRole('alert')
    expect(conflictAlert).toHaveTextContent(
      'The draft changed elsewhere — reload to see the latest',
    )
    expect(conflictAlert).not.toHaveTextContent('Modified concurrently')

    await user.click(screen.getByRole('button', { name: /retry after reload/i }))

    const putBodies = fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
    expect(putBodies).toHaveLength(2)
    const retriedBody = JSON.parse(String(putBodies[1]?.body)) as {
      elements: readonly { label: string | null }[]
    }
    expect(retriedBody.elements[0]?.label).toBe('Edited title')
    expect(document.body.textContent).not.toContain('Modified concurrently')
  })

  it('does not issue the retried PUT until the draft refetch resolves', async () => {
    const user = userEvent.setup()
    let draftGets = 0
    let resolveRefetch: ((response: Response) => void) | undefined
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
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByRole('alert')

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: /retry after reload/i }))
      await vi.runAllTimersAsync()
      expect(
        fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT'),
      ).toHaveLength(1)

      resolveRefetch?.(jsonResponse(DRAFT_DTO))
      for (let i = 0; i < 20; i += 1) {
        await vi.advanceTimersByTimeAsync(0)
        if (
          fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT').length === 2
        )
          break
      }
      expect(
        fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT'),
      ).toHaveLength(2)
      const putBodies = fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
      const retriedBody = JSON.parse(String(putBodies[1]?.body)) as {
        elements: readonly { label: string | null }[]
      }
      expect(retriedBody.elements[0]?.label).toBe('Edited title')
      expect(document.body.textContent).not.toContain('Modified concurrently')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire the retried PUT when the draft refetch fails and keeps the conflict state', async () => {
    const user = userEvent.setup()
    let draftGets = 0
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
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /retry after reload/i }))

    expect(
      fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT'),
    ).toHaveLength(1)
    const conflictAlert = await screen.findByRole('alert')
    expect(conflictAlert).toHaveTextContent(
      'The draft changed elsewhere — reload to see the latest',
    )
    expect(screen.getByRole('button', { name: /retry after reload/i })).toBeInTheDocument()
    expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Edited title')
    expect(document.body.textContent).not.toContain('Modified concurrently')
  })

  it.each(['save', 'publish'] as const)(
    'guards retry after reload against reentrant clicks (%s): one refetch, one retry mutation',
    async (scope) => {
      const user = userEvent.setup()
      let draftGets = 0
      let resolveRefetch: ((response: Response) => void) | undefined
      const draftGetCalls = () =>
        fetchMock.mock.calls.filter(([input, init]) => {
          return (
            requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft` &&
            (init?.method ?? 'GET') === 'GET'
          )
        })
      const retryMutationCalls = () =>
        fetchMock.mock.calls.filter(([input, init]) => {
          const method = init?.method ?? 'GET'
          if (scope === 'save') {
            return (
              requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft` &&
              method === 'PUT'
            )
          }
          return (
            requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish` &&
            method === 'POST'
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
          return jsonResponse([])
        }
        if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
          return jsonResponse(TAXONOMY_DTO)
        }
        if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
          return jsonResponse(
            { error: { code: 'conflict', message: 'Modified concurrently' } },
            409,
          )
        }
        if (
          method === 'POST' &&
          url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/publish`
        ) {
          return jsonResponse(
            { error: { code: 'conflict', message: 'Modified concurrently' } },
            409,
          )
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      await mountBuilder()

      if (scope === 'save') {
        const labels = await screen.findAllByLabelText('Label')
        await user.clear(labels[0]!)
        await user.type(labels[0]!, 'Edited title')
        await user.click(screen.getByRole('button', { name: /save/i }))
      } else {
        await user.click(await screen.findByRole('button', { name: /publish/i }))
        await user.click(await screen.findByRole('button', { name: /confirm publish/i }))
      }
      await screen.findByRole('alert')

      vi.useFakeTimers()
      try {
        const retryButton = screen.getByRole('button', { name: /retry after reload/i })
        fireEvent.click(retryButton)
        await vi.runAllTimersAsync()
        expect(draftGetCalls()).toHaveLength(2)
        expect(retryMutationCalls()).toHaveLength(1)
        // The retry action must be guarded while the refetch is pending: a
        // second click must not schedule another retry.
        expect(retryButton).toHaveAttribute('aria-disabled', 'true')
        fireEvent.click(retryButton)
        await vi.runAllTimersAsync()
        expect(retryMutationCalls()).toHaveLength(1)

        resolveRefetch?.(jsonResponse(DRAFT_DTO))
        for (let i = 0; i < 20; i += 1) {
          await vi.advanceTimersByTimeAsync(0)
          if (retryMutationCalls().length > 1) break
        }
        expect(retryMutationCalls()).toHaveLength(2)
        if (scope === 'save') {
          const retriedBody = JSON.parse(
            String(
              fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')[1]?.body,
            ),
          ) as {
            elements: readonly { label: string | null }[]
          }
          expect(retriedBody.elements[0]?.label).toBe('Edited title')
        }
        expect(document.body.textContent).not.toContain('Modified concurrently')
      } finally {
        vi.useRealTimers()
      }
    },
  )

  // R2-1.3(a): discarding throws away unsaved edits during a 409, which is the
  // moment those edits are the only copy. It gets the plain confirm rung.
  it('asks before discarding the edits, and keeps them when the question is cancelled', async () => {
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
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /discard my changes/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/cannot be undone/i)
    // Cancel is the resting choice (C0 §8) and it changes nothing.
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Edited title')

    await user.click(screen.getByRole('button', { name: /discard my changes/i }))
    const confirmDialog = await screen.findByRole('dialog')
    // The trigger and the answer carry different names on purpose, so a click
    // — or a strict selector — can never land on the wrong one.
    expect(within(confirmDialog).queryByRole('button', { name: /discard my changes/i })).toBeNull()
    await user.click(within(confirmDialog).getByRole('button', { name: 'Discard them' }))

    await waitFor(() => expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Title'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Confirming adds no request of its own.
    expect(
      fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT'),
    ).toHaveLength(1)
  })

  it('reloads the server draft on conflict instead of silently overwriting', async () => {
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
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')
    await user.click(screen.getByRole('button', { name: /save/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The draft changed elsewhere — reload to see the latest')

    await user.click(screen.getByRole('button', { name: /reload latest/i }))
    expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Title')
  })

  it('renders distinct expired-session, forbidden, and denied load states', async () => {
    const states: Array<{ status: number; code: string; heading: string }> = [
      { status: 401, code: 'unauthorized', heading: 'Session expired' },
      { status: 403, code: 'forbidden', heading: 'Access forbidden' },
      { status: 404, code: 'not_found', heading: 'Not found' },
    ]

    for (const state of states) {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
          return jsonResponse({ error: { code: state.code, message: state.heading } }, state.status)
        }
        if (
          method === 'GET' &&
          url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`
        ) {
          // Both reads sit behind the same session/actor middleware and the
          // same form lookup, so a denial reaches them together. The versions
          // answer is what tells a missing form apart from a form that simply
          // has no draft yet.
          return jsonResponse({ error: { code: state.code, message: state.heading } }, state.status)
        }
        if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
          return jsonResponse(TAXONOMY_DTO)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      await mountBuilder()

      expect(await screen.findByText(state.heading)).toBeInTheDocument()
      if (state.heading === 'Session expired') {
        expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
      }
      for (const other of states) {
        if (other.heading !== state.heading) {
          expect(screen.queryByText(other.heading)).not.toBeInTheDocument()
        }
      }
      cleanup()
    }
  })

  // R1-B4 / F-R5-14: the seeded demo ships a form whose only version is
  // published, the draft read answers 404, and the whole builder used to be
  // replaced by a page-level "Not found" — with no shell, no version list and
  // no way to start editing.
  describe('a form with no draft', () => {
    const PUBLISHED_VERSION_ID = 'f0000000-0000-4000-8000-000000000009'
    const PUBLISHED_DTO: FormVersionDetailDto = {
      ...DRAFT_DTO,
      versionId: PUBLISHED_VERSION_ID,
      version: 1,
      status: 'published',
      contentHash: 'hash-1',
      publishedAt: '2026-08-01T09:00:00.000Z',
    }

    function noDraftHandler(overrides: { readonly versions?: Response } = {}) {
      return (url: string, init?: RequestInit): Response => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        if (
          method === 'GET' &&
          url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`
        ) {
          return (
            overrides.versions ??
            jsonResponse([
              {
                id: PUBLISHED_VERSION_ID,
                formId: FORM_ID,
                version: 1,
                status: 'published',
                publishedAt: '2026-08-01T09:00:00.000Z',
                updatedAt: '2026-08-01T09:00:00.000Z',
              },
            ])
          )
        }
        if (
          method === 'GET' &&
          url ===
            `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${PUBLISHED_VERSION_ID}`
        ) {
          return jsonResponse(PUBLISHED_DTO)
        }
        if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
          return jsonResponse(TAXONOMY_DTO)
        }
        if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
          return jsonResponse(reissueContent(JSON.parse(String(init?.body)) as DraftPayload))
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
    }

    it('renders the builder shell, the version list and a way to start a draft instead of a not-found page', async () => {
      fetchHandler = noDraftHandler()
      await mountBuilder()

      expect(await screen.findByRole('heading', { level: 1, name: 'Form builder' })).toBeVisible()
      expect(document.querySelector('[data-slot="empty-state-title"]')).toHaveTextContent(
        'Start a new draft',
      )
      expect(screen.getByText(/version 1 is published and frozen/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /start a new draft/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /version 1/i })).toHaveAttribute(
        'href',
        `/admin/events/${EVENT_SLUG}/forms/${FORM_ID}/versions/${PUBLISHED_VERSION_ID}`,
      )
      expect(screen.queryByText('This page could not be found.')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('forks the published version into a draft and opens the editor on it', async () => {
      const user = userEvent.setup()
      fetchHandler = noDraftHandler()
      await mountBuilder()

      await user.click(await screen.findByRole('button', { name: /start a new draft/i }))

      const put = fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
      const body = JSON.parse(String(put?.body)) as DraftPayload
      expect(body.elements.map((element) => element.label)).toEqual(['Title', 'Abstract'])
      expect(await screen.findByRole('button', { name: /^save$/i })).toBeInTheDocument()
      expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Title')
      expect(screen.getByRole('status')).toHaveTextContent('Draft started')
    })

    it('starts an empty draft when the form has no published version to copy', async () => {
      const user = userEvent.setup()
      fetchHandler = noDraftHandler({ versions: jsonResponse([]) })
      await mountBuilder()

      await user.click(await screen.findByRole('button', { name: /start a new draft/i }))

      const put = fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
      const body = JSON.parse(String(put?.body)) as DraftPayload
      expect(body).toEqual({ pages: [], elements: [], conditionRules: [], routingRules: [] })
    })

    it('still shows the not-found page when the form itself does not exist', async () => {
      fetchHandler = noDraftHandler({
        versions: jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404),
      })
      await mountBuilder()

      expect(await screen.findByText('Not found')).toBeInTheDocument()
      expect(screen.queryByText('Start a new draft')).not.toBeInTheDocument()
      // V-B4-H11: the tab is the one place a reader is told which page they are
      // on when the page is not on screen, and it said "Form builder".
      await waitFor(() => expect(document.title).toBe('Not found — SpeakerOps'))
    })

    it('titles the tab for the builder itself when the form is merely draftless', async () => {
      fetchHandler = noDraftHandler({ versions: jsonResponse([]) })
      await mountBuilder()

      await screen.findByRole('button', { name: /start a new draft/i })
      await waitFor(() => expect(document.title).toBe('Form builder — SpeakerOps'))
    })
  })

  // RV3 NEW-1, the same H11 question one answer further along: signed out, the
  // route renders the expired state correctly and the tab went on naming the
  // builder. /agenda, /evaluations and /readiness already title this moment.
  it('titles the tab for the expired session when the draft read is refused', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url.startsWith(`/api/admin/events/${EVENT_SLUG}/forms/${FORM_ID}`)) {
        return jsonResponse({ error: { code: 'unauthorized', message: 'Session expired' } }, 401)
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    expect(await screen.findByText('Session expired')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Session expired — SpeakerOps'))
  })

  it('shows Saving… and keeps Save disabled while the mutation is pending, then re-enables', async () => {
    const user = userEvent.setup()
    let resolveSave: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse(DRAFT_DTO)
      }
      if (
        method === 'GET' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`
      ) {
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return new Promise<Response>((resolve) => {
          resolveSave = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')
    await user.click(screen.getByRole('button', { name: /save/i }))

    const pendingButton = screen.getByRole('button', { name: /saving/i })
    expect(pendingButton).toHaveTextContent('Saving…')
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true')

    resolveSave?.(jsonResponse(DRAFT_DTO))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
  })

  it('renders no internal ids, contentHash, or raw server messages', async () => {
    await mountBuilder()

    expect(await screen.findByDisplayValue('Title')).toBeInTheDocument()
    const renderedText = document.body.textContent ?? ''
    expect(renderedText).not.toContain(FORM_ID)
    expect(renderedText).not.toContain(VERSION_ID)
    expect(renderedText).not.toContain('a'.repeat(64))
    expect(renderedText).not.toContain('Modified concurrently')
  })

  it('renders the new form initial-load error after a route form-id change', async () => {
    const FORM_B = 'f0000000-0000-4000-8000-0000000000bb'
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse(DRAFT_DTO)
      }
      if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_B}/draft`) {
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      if (
        method === 'GET' &&
        (url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions` ||
          url === `/api/admin/events/demo-conf-2026/forms/${FORM_B}/versions`)
      ) {
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { router } = await mountBuilder()

    expect(await screen.findByDisplayValue('Title')).toBeInTheDocument()
    await router.navigate({
      to: '/admin/events/$slug/forms/$formId',
      params: { slug: EVENT_SLUG, formId: FORM_B },
    })

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Title')).not.toBeInTheDocument()
    expect(fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_B}/draft`, 'GET')).toBeDefined()
  })

  it('does not clear dirty edits when background draft data arrives', async () => {
    const user = userEvent.setup()
    let draftGets = 0
    const freshDraft = {
      ...DRAFT_DTO,
      updatedAt: '2026-08-08T09:30:00.000Z',
      elements: [{ ...DRAFT_DTO.elements[0], label: 'Server title' }, DRAFT_DTO.elements[1]],
    }
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        draftGets += 1
        return jsonResponse(draftGets > 1 ? freshDraft : DRAFT_DTO)
      }
      if (
        method === 'GET' &&
        url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`
      ) {
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { queryClient } = await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: adminFormQueryKeys.draft(FORM_ID) })
    })
    expect(
      fetchMock.mock.calls.filter(([input, init]) => {
        return (
          requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft` &&
          (init?.method ?? 'GET') === 'GET'
        )
      }),
    ).toHaveLength(2)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Edited title')
  })

  it('keeps the conflict state and edited model when reload latest fails', async () => {
    const user = userEvent.setup()
    let draftGets = 0
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
        return jsonResponse([])
      }
      if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
        return jsonResponse(TAXONOMY_DTO)
      }
      if (method === 'PUT' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
        return jsonResponse({ error: { code: 'conflict', message: 'Modified concurrently' } }, 409)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.type(labels[0]!, 'Edited title')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /reload latest/i }))

    expect(
      fetchCalls(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT'),
    ).toHaveLength(1)
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input, init]) => {
          return (
            requestUrl(input) === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft` &&
            (init?.method ?? 'GET') === 'GET'
          )
        }),
      ).toHaveLength(2)
    })
    expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Edited title')
    expect(
      screen.getByText('The draft changed elsewhere — reload to see the latest'),
    ).toBeInTheDocument()
  })
})
