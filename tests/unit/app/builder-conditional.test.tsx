import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

import { updateFormDraft } from '../../../src/app/api/admin-forms'
import BuilderEditor from '../../../src/app/features/builder/BuilderEditor'
import ConditionRuleEditor from '../../../src/app/features/builder/ConditionRuleEditor'
import ElementEditor from '../../../src/app/features/builder/ElementEditor'
import RoutingRuleEditor from '../../../src/app/features/builder/RoutingRuleEditor'
import TaxonomyPicker from '../../../src/app/features/builder/TaxonomyPicker'

const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
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
      fieldKey: 'format',
      label: 'Format',
      required: true,
      maxLength: null,
      questionType: 'single_choice',
      options: ['talk', 'workshop'],
    },
    {
      id: 'e-2',
      pageId: 'p-1',
      position: 1,
      kind: 'question',
      fieldKey: 'rating',
      label: 'Rating',
      required: false,
      maxLength: null,
      questionType: 'number',
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
  routingRules: [
    {
      id: 'rr-1',
      position: 0,
      condition: {
        groups: [{ conditions: [{ operator: 'eq', operandKey: 'format', value: 'talk' }] }],
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
    { id: 't-3', kind: 'tag', key: 'beginner', label: 'Beginner', position: 0 },
    { id: 't-4', kind: 'tag', key: 'advanced', label: 'Advanced', position: 1 },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response

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

async function mountBuilder(
  initialEntry = `/admin/events/${EVENT_SLUG}/forms/${FORM_ID}`,
  routePath = '/admin/events/$slug/forms/$formId',
) {
  const rootRoute = createRootRoute()
  const builderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: routePath,
    component: BuilderEditor,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([builderRoute]),
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
  return { router }
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
      const body = JSON.parse(String(init?.body)) as {
        conditionRules: unknown
        routingRules: unknown
      }
      return jsonResponse({
        ...DRAFT_DTO,
        conditionRules: body.conditionRules,
        routingRules: body.routingRules,
      })
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

describe('builder conditional visibility and routing rules', () => {
  it('exposes the intended rule-editing module surface', () => {
    expect(BuilderEditor).toBeTypeOf('function')
    expect(ConditionRuleEditor).toBeTypeOf('function')
    expect(RoutingRuleEditor).toBeTypeOf('function')
    expect(TaxonomyPicker).toBeTypeOf('function')
    expect(ElementEditor).toBeTypeOf('function')
    expect(updateFormDraft).toBeTypeOf('function')
  })

  it('edits show/hide/require effects and OR-of-AND condition groups', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    expect(await screen.findByRole('combobox', { name: /effect/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add condition' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add group' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add condition' }))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    const put = fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT')
    const body = JSON.parse(String(put?.body)) as {
      conditionRules: readonly {
        readonly groups: readonly unknown[]
        readonly position: number
      }[]
      routingRules: readonly { readonly position: number }[]
    }
    expect(body.conditionRules[0]?.groups).toHaveLength(2)
    expect(body.conditionRules[0]?.position).toBe(0)
    expect(body.routingRules[0]?.position).toBe(0)
  })

  it('restricts condition operators by operand question type', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const operandTrigger = await screen.findByRole('combobox', { name: /operand/i })
    await user.click(operandTrigger)
    await user.click(await screen.findByRole('option', { name: 'Rating' }))

    const operatorTrigger = screen.getByRole('combobox', { name: /operator/i })
    await user.click(operatorTrigger)
    const numberOperators = await screen.findByRole('listbox')
    expect(within(numberOperators).getByRole('option', { name: 'gt' })).toBeInTheDocument()
    expect(within(numberOperators).getByRole('option', { name: 'lt' })).toBeInTheDocument()

    await user.click(within(numberOperators).getByRole('option', { name: 'eq' }))
    await user.click(operandTrigger)
    await user.click(await screen.findByRole('option', { name: 'Format' }))
    await user.click(operatorTrigger)
    const choiceOperators = await screen.findByRole('listbox')
    expect(within(choiceOperators).queryByRole('option', { name: 'gt' })).not.toBeInTheDocument()
    expect(within(choiceOperators).queryByRole('option', { name: 'lt' })).not.toBeInTheDocument()
  })

  it('rejects a malformed condition value without saving', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    const valueInput = await screen.findByLabelText('Value')
    await user.clear(valueInput)
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(valueInput).toHaveFocus())
    expect(
      fetchCall(`/api/admin/events/demo-conf-2026/forms/${FORM_ID}/draft`, 'PUT'),
    ).toBeUndefined()
  })

  it('kind-aware routing target picker: assign_track/assign_tag/manual_review', async () => {
    const user = userEvent.setup()
    await mountBuilder()

    expect(fetchCall(`/api/admin/events/${EVENT_SLUG}/taxonomies`, 'GET')).toBeDefined()

    const actionTrigger = await screen.findByRole('combobox', { name: /action kind/i })
    await user.click(actionTrigger)
    await user.click(await screen.findByRole('option', { name: /assign_track/i }))

    const targetTrigger = screen.getByRole('combobox', { name: /target/i })
    await user.click(targetTrigger)
    const trackOptions = await screen.findAllByRole('option')
    expect(trackOptions.some((option) => option.textContent === 'Talk')).toBe(true)
    expect(trackOptions.some((option) => option.textContent === 'Workshop')).toBe(true)
    expect(trackOptions.some((option) => option.textContent === 'Beginner')).toBe(false)

    await user.click(await screen.findByRole('option', { name: 'Talk' }))
    await user.click(actionTrigger)
    await user.click(await screen.findByRole('option', { name: /manual_review/i }))
    expect(screen.queryByRole('combobox', { name: /target/i })).not.toBeInTheDocument()

    await user.click(actionTrigger)
    await user.click(await screen.findByRole('option', { name: /assign_tag/i }))
    await user.click(screen.getByRole('combobox', { name: /target/i }))
    const tagOptions = await screen.findAllByRole('option')
    expect(tagOptions.some((option) => option.textContent === 'Beginner')).toBe(true)
    expect(tagOptions.some((option) => option.textContent === 'Talk')).toBe(false)
  })

  // O3: the event slug is a mandatory path segment, so a slugless mount can no
  // longer address a form at all — every form-scoped fetch (draft, versions,
  // taxonomies) stays disabled rather than firing unscoped requests.
  it('a mount without an event slug fetches nothing form-scoped', async () => {
    await mountBuilder(`/admin/forms/${FORM_ID}`, '/admin/forms/$formId')

    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).endsWith('/taxonomies'))).toBe(
      false,
    )
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/draft'))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/versions'))).toBe(
      false,
    )
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
