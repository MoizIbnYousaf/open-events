import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

import type { FormVersionDetailDto } from '../../../src/application'
import { getFormDraft } from '../../../src/app/api/admin-forms'
import BuilderEditor from '../../../src/app/features/builder/BuilderEditor'
import PreviewDialog from '../../../src/app/features/builder/PreviewDialog'
import { validateAnswersAgainstVersion } from '../../../src/domain/invariants/submission'
import { applyRoutingRules, isElementRequired, isElementVisible } from '../../../src/domain/rules'
import type { FormVersionContent } from '../../../src/domain'

const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const EVENT_SLUG = 'demo-conf-2026'

const CONTENT: FormVersionContent = {
  pages: [
    {
      id: 'p-1',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      position: 0,
      kind: 'welcome',
      title: 'Welcome',
      content: 'Introduction',
    },
  ],
  elements: [
    {
      id: 'e-1',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
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
      eventId: EVENT_ID,
      versionId: VERSION_ID,
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
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      elementId: 'e-2',
      effect: 'show',
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'title', value: 'draft' }],
        },
      ],
      position: 0,
    },
    {
      id: 'r-2',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      elementId: 'e-2',
      effect: 'require',
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'title', value: 'draft' }],
        },
      ],
      position: 1,
    },
  ],
  routingRules: [
    {
      id: 'rr-1',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      position: 0,
      condition: {
        groups: [{ conditions: [{ operator: 'eq', operandKey: 'title', value: 'draft' }] }],
      },
      actionKind: 'assign_track',
      actionTarget: 'talk',
    },
  ],
}

const DRAFT_DTO: FormVersionDetailDto = {
  formId: FORM_ID,
  eventId: EVENT_ID,
  versionId: VERSION_ID,
  version: 1,
  status: 'draft',
  contentHash: null,
  publishedAt: null,
  updatedAt: '2026-08-08T09:00:00.000Z',
  pages: CONTENT.pages.map(({ id, position, kind, title, content }) => ({
    id,
    position,
    kind,
    title,
    content,
  })),
  elements: CONTENT.elements.map(
    ({
      id,
      pageId,
      position,
      kind,
      fieldKey,
      label,
      required,
      maxLength,
      questionType,
      options,
    }) => ({
      id,
      pageId,
      position,
      kind,
      fieldKey,
      label,
      required,
      maxLength,
      questionType,
      options,
    }),
  ),
  conditionRules: CONTENT.conditionRules.map(({ id, elementId, effect, position, groups }) => ({
    id,
    elementId,
    effect,
    position,
    groups,
  })),
  routingRules: CONTENT.routingRules.map(
    ({ id, position, condition, actionKind, actionTarget }) => ({
      id,
      position,
      condition,
      actionKind,
      actionTarget,
    }),
  ),
}

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

async function mountBuilder() {
  const rootRoute = createRootRoute()
  const builderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/forms/$formId',
    component: BuilderEditor,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([builderRoute]),
    history: createMemoryHistory({
      initialEntries: [`/admin/forms/${FORM_ID}?eventSlug=${EVENT_SLUG}`],
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
  return { router }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === `/api/admin/forms/${FORM_ID}/draft`) {
      return jsonResponse(DRAFT_DTO)
    }
    if (method === 'GET' && url === `/api/admin/forms/${FORM_ID}/versions`) {
      return jsonResponse([])
    }
    if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
      return jsonResponse(TAXONOMY_DTO)
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

describe('builder local draft preview parity', () => {
  it('exposes the intended preview module surface', () => {
    expect(BuilderEditor).toBeTypeOf('function')
    expect(PreviewDialog).toBeTypeOf('function')
    expect(getFormDraft).toBeTypeOf('function')
    expect(isElementVisible).toBeTypeOf('function')
    expect(isElementRequired).toBeTypeOf('function')
    expect(applyRoutingRules).toBeTypeOf('function')
    expect(validateAnswersAgainstVersion).toBeTypeOf('function')
  })

  it('opens the preview with zero network calls and keeps it call-free while answering', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const callsBeforeOpen = fetchMock.mock.calls.length
    await user.click(await screen.findByRole('button', { name: /preview/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    const title = await screen.findByLabelText('Title')
    await user.type(title, 'draft')
    expect(fetchMock.mock.calls.length).toBe(callsBeforeOpen)
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.length).toBe(callsBeforeOpen)
  })

  it('moves focus into the first preview field on open and back to the preview trigger on close', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const previewButton = await screen.findByRole('button', { name: /preview/i })
    await user.click(previewButton)

    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus())
    await user.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => expect(document.activeElement).toBe(previewButton))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
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

  it('visibility parity: the preview matches isElementVisible for the same answers', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /preview/i }))
    const title = await screen.findByLabelText('Title')

    await user.type(title, 'draft')
    const abstractElement = CONTENT.elements[1]!
    expect(isElementVisible(abstractElement, CONTENT.conditionRules, { title: 'draft' })).toBe(true)
    expect(await screen.findByLabelText('Abstract')).toBeInTheDocument()

    await user.clear(title)
    await user.type(title, 'x')
    expect(isElementVisible(abstractElement, CONTENT.conditionRules, { title: 'x' })).toBe(false)
    await waitFor(() => {
      expect(screen.queryByLabelText('Abstract')).not.toBeInTheDocument()
    })
  })

  it('requiredness parity: the preview matches isElementRequired for the same answers', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /preview/i }))
    const title = await screen.findByLabelText('Title')
    await user.type(title, 'draft')

    const abstractElement = CONTENT.elements[1]!
    expect(isElementRequired(abstractElement, CONTENT.conditionRules, { title: 'draft' })).toBe(
      true,
    )
    expect(await screen.findByLabelText('Abstract')).toBeRequired()
  })

  it('routing parity: the preview shows the applyRoutingRules outcome for the same answers', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /preview/i }))
    const title = await screen.findByLabelText('Title')

    await user.type(title, 'draft')
    expect(applyRoutingRules(CONTENT.routingRules, { title: 'draft' })).toEqual({
      actionKind: 'assign_track',
      actionTarget: 'talk',
    })
    expect(await screen.findByText('Talk')).toBeInTheDocument()

    await user.clear(title)
    await user.type(title, 'x')
    expect(applyRoutingRules(CONTENT.routingRules, { title: 'x' })).toBeNull()
    await waitFor(() => {
      expect(screen.queryByText('Talk')).not.toBeInTheDocument()
    })
  })

  it('validation parity: preview issues match the engine and the first invalid field is focused', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    await user.click(await screen.findByRole('button', { name: /preview/i }))
    const title = await screen.findByLabelText('Title')
    await user.click(screen.getByRole('button', { name: /submit preview/i }))

    const engineIssues = validateAnswersAgainstVersion(CONTENT, {})
    expect(engineIssues.some((issue) => issue.code === 'missing_required')).toBe(true)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(title).toHaveFocus())
  })
})
