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

import type { FormVersionDetailDto, SaveFormDraftInput } from '../../../src/application'
import { getFormDraft, updateFormDraft } from '../../../src/app/api/admin-forms'
import BuilderEditor from '../../../src/app/features/builder/BuilderEditor'
import ElementEditor from '../../../src/app/features/builder/ElementEditor'
import PageList from '../../../src/app/features/builder/PageList'
import ReorderControls from '../../../src/app/features/builder/ReorderControls'

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
  pages: [
    { id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: 'Introduction' },
    { id: 'p-2', position: 1, kind: 'info', title: 'Details', content: '' },
  ],
  elements: [
    {
      id: 'e-1',
      pageId: 'p-1',
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
      fieldKey: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
    {
      id: 'e-3',
      pageId: 'p-1',
      position: 2,
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
      elementId: 'e-3',
      effect: 'show',
      position: 0,
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'format', value: 'talk' }],
        },
      ],
    },
  ],
  routingRules: [],
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

const TAXONOMY_DTO = {
  eventId: EVENT_ID,
  items: [
    { id: 't-1', kind: 'track', key: 'talk', label: 'Talk', position: 0 },
    { id: 't-2', kind: 'track', key: 'workshop', label: 'Workshop', position: 1 },
    { id: 't-3', kind: 'tag', key: 'beginner', label: 'Beginner', position: 0 },
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
    if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`) {
      return jsonResponse(DRAFT_DTO)
    }
    if (method === 'GET' && url === `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions`) {
      return jsonResponse(VERSIONS_DTO)
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
  cleanup()
})

describe('builder element ordering', () => {
  it('exposes the intended ordering module surface', () => {
    expect(BuilderEditor).toBeTypeOf('function')
    expect(PageList).toBeTypeOf('function')
    expect(ElementEditor).toBeTypeOf('function')
    expect(ReorderControls).toBeTypeOf('function')
    expect(getFormDraft).toBeTypeOf('function')
    expect(updateFormDraft).toBeTypeOf('function')
  })

  it('renders an explicit Move up and Move down button for every element', async () => {
    await mountBuilder()

    expect(await screen.findByDisplayValue('Format')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /move up/i })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: /move down/i })).toHaveLength(3)
  })

  it('renders elements under their own page and pins page membership in the payload', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    expect(await screen.findByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Details')).toBeInTheDocument()
    expect(
      screen.getAllByLabelText('Label').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['Format', 'Abstract', 'Title'])

    await user.click(screen.getByRole('button', { name: /save/i }))
    const put = fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
    const body = JSON.parse(String(put?.body)) as {
      elements: readonly { id: string; pageId: string }[]
    }
    expect(body.elements.map((element) => [element.id, element.pageId])).toEqual([
      ['e-1', 'p-1'],
      ['e-3', 'p-1'],
      ['e-2', 'p-2'],
    ])
  })

  it('reorders via Move down, keeps focus on the control, and announces the new position', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const downButtons = await screen.findAllByRole('button', { name: /move down/i })
    await user.click(downButtons[0]!)

    expect(await screen.findByRole('status')).toHaveTextContent(/moved to position 1/i)
    expect(document.activeElement).toHaveTextContent(/move/i)
  })

  it('persists the reordered element order in the full-replace PUT body', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const downButtons = await screen.findAllByRole('button', { name: /move down/i })
    await user.click(downButtons[0]!)
    await user.click(screen.getByRole('button', { name: /save/i }))

    const put = fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
    const body = JSON.parse(String(put?.body)) as { elements: readonly { id: string }[] }
    expect(body.elements.map((element) => element.id)).toEqual(['e-3', 'e-1', 'e-2'])
  })

  it('reloads the persisted order after a successful save', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const downButtons = await screen.findAllByRole('button', { name: /move down/i })
    await user.click(downButtons[0]!)
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(screen.getAllByLabelText('Label')[0]).toHaveValue('Abstract')
  })

  it('focuses the first invalid element and shows an alert without saving', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const labels = await screen.findAllByLabelText('Label')
    await user.clear(labels[0]!)
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Label')[0]).toHaveFocus()
    expect(
      fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT'),
    ).toBeUndefined()
  })

  it('renders no internal ids, contentHash, or raw server messages', async () => {
    await mountBuilder()

    expect(await screen.findByDisplayValue('Format')).toBeInTheDocument()
    const renderedText = document.body.textContent ?? ''
    expect(renderedText).not.toContain(FORM_ID)
    expect(renderedText).not.toContain(VERSION_ID)
    expect(renderedText).not.toContain('a'.repeat(64))
    expect(renderedText).not.toContain('Modified concurrently')
  })
})
