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

import type { FormDefinitionDto, FormElementDto } from '../../../src/application'
import type { FormVersionContent } from '../../../src/domain'
import { createQueryClient } from '../../../src/app/query-client'
import EventConfig from '../../../src/app/features/admin/EventConfig'
import TaxonomyEditor from '../../../src/app/features/admin/TaxonomyEditor'
import CfpFields from '../../../src/app/features/public/CfpFields'
import CfpWizard from '../../../src/app/features/public/CfpWizard'
import HeadshotUploader from '../../../src/app/features/public/HeadshotUploader'
import ConditionRuleEditor from '../../../src/app/features/builder/ConditionRuleEditor'
import ElementEditor from '../../../src/app/features/builder/ElementEditor'
import RoutingRuleEditor from '../../../src/app/features/builder/RoutingRuleEditor'
import PreviewEngine from '../../../src/app/features/builder/preview-engine'

/**
 * The one behavioural contract behind Shadscan's three [error] form checks:
 * every control has a programmatic label, every computed validation problem is
 * rendered where the user is, and every aria-invalid control names the element
 * that says what is wrong. One helper asserts all three so no surface can pass
 * two of them and quietly fail the third.
 */
function expectLinkedError(control: HTMLElement, message: RegExp): void {
  expect(control).toHaveAttribute('aria-invalid', 'true')
  const ids = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
  expect(ids.length).toBeGreaterThan(0)
  const text = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
  expect(text).toMatch(message)
}

const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const EVENT_SLUG = 'demo-conf-2026'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'

const EVENT_CONFIG_DTO = {
  id: EVENT_ID,
  slug: EVENT_SLUG,
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

const TAXONOMY_DTO = {
  eventId: EVENT_ID,
  items: [
    { id: 't-1', kind: 'track', key: 'talk', label: 'Talk', position: 0 },
    { id: 't-2', kind: 'track', key: 'workshop', label: 'Workshop', position: 1 },
    { id: 't-3', kind: 'tag', key: 'beginner', label: 'Beginner', position: 0 },
  ],
}

const MULTI_CHOICE_ELEMENT: FormElementDto = {
  id: 'e-multi',
  pageId: 'p-2',
  position: 0,
  kind: 'question',
  fieldKey: 'topics',
  label: 'Topics',
  required: true,
  maxLength: null,
  questionType: 'multi_choice',
  options: ['testing', 'tooling'],
}

const CO_SPEAKER_FORM: FormDefinitionDto = {
  formId: FORM_ID,
  formSlug: 'cfp',
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
      fieldKey: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
  ],
  conditionRules: [],
}

const PREVIEW_CONTENT: FormVersionContent = {
  pages: [
    {
      id: 'p-1',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      position: 0,
      kind: 'welcome',
      title: 'Welcome',
      content: '',
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
      maxLength: null,
      questionType: 'short_text',
      options: [],
      optionsSource: null,
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

function notFound(): Response {
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

beforeEach(() => {
  fetchHandler = () => notFound()
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

async function mountAdminRoute(path: string, Component: () => React.ReactElement) {
  const rootRoute = createRootRoute()
  const route = createRoute({ getParentRoute: () => rootRoute, path, component: Component })
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [path.replace('$slug', EVENT_SLUG)],
    }),
  })
  render(
    <QueryClientProvider client={createQueryClient()}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup() }
}

describe('forms a11y contract', () => {
  describe('event settings', () => {
    beforeEach(() => {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}`) {
          return jsonResponse(EVENT_CONFIG_DTO)
        }
        if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/forms`) {
          return jsonResponse([])
        }
        return notFound()
      }
    })

    it('links the timezone error to the timezone input', async () => {
      const { user } = await mountAdminRoute('/admin/events/$slug', EventConfig)

      const timezone = await screen.findByLabelText('Timezone')
      await user.clear(timezone)
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.getByLabelText('Timezone')).toHaveAttribute('aria-invalid'))
      expectLinkedError(screen.getByLabelText('Timezone'), /timezone is required/i)
    })

    it('gives the status select a real programmatic label', async () => {
      await mountAdminRoute('/admin/events/$slug', EventConfig)

      const status = await screen.findByLabelText('Status')
      expect(status).toHaveAttribute('role', 'combobox')
    })

    it('renders exactly one role=alert summary when a field is invalid', async () => {
      const { user } = await mountAdminRoute('/admin/events/$slug', EventConfig)

      const timezone = await screen.findByLabelText('Timezone')
      await user.clear(timezone)
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1))
    })
  })

  describe('taxonomies', () => {
    beforeEach(() => {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
          return jsonResponse(TAXONOMY_DTO)
        }
        return notFound()
      }
    })

    it('links the key error to the key input', async () => {
      const { user } = await mountAdminRoute('/admin/events/$slug/taxonomies', TaxonomyEditor)

      const key = (await screen.findAllByLabelText('Key'))[0]!
      await user.clear(key)
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(screen.getAllByLabelText('Key')[0]).toHaveAttribute('aria-invalid'),
      )
      expectLinkedError(screen.getAllByLabelText('Key')[0]!, /key is required/i)
    })
  })

  describe('headshot uploader', () => {
    beforeEach(() => {
      fetchHandler = (url) => {
        if (url === '/api/public/headshot') {
          return jsonResponse({ error: { code: 'not_found', message: 'none' } }, 404)
        }
        return notFound()
      }
    })

    it('links the rejection message to the file input', async () => {
      const user = userEvent.setup()
      render(
        <QueryClientProvider client={createQueryClient()}>
          <HeadshotUploader />
        </QueryClientProvider>,
      )

      const input = await screen.findByLabelText(/upload a headshot/i)
      const tooBig = new File([new Uint8Array(3 * 1024 * 1024)], 'huge.png', { type: 'image/png' })
      await user.upload(input, tooBig)

      await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
      expectLinkedError(input, /2 MB|too large|not supported/i)
    })
  })

  describe('CFP multi-choice group', () => {
    it('puts the invalid state on the checkboxes, not on the fieldset', () => {
      render(
        <CfpFields
          element={MULTI_CHOICE_ELEMENT}
          domId="cfp-1-0"
          value={[]}
          error="Choose at least one topic"
          onChange={() => undefined}
        />,
      )

      const first = screen.getByRole('checkbox', { name: 'testing' })
      expectLinkedError(first, /choose at least one topic/i)
      const fieldset = document.querySelector('fieldset')
      expect(fieldset).not.toBeNull()
      expect(fieldset).not.toHaveAttribute('aria-invalid')
    })
  })

  describe('co-speaker rows', () => {
    beforeEach(() => {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        return notFound()
      }
    })

    async function mountToSubmitStep() {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      const user = userEvent.setup()
      render(
        <QueryClientProvider client={queryClient}>
          <CfpWizard form={CO_SPEAKER_FORM} eventSlug={EVENT_SLUG} formSlug="cfp" />
        </QueryClientProvider>,
      )
      await user.click(await screen.findByRole('button', { name: /next/i }))
      await user.type(await screen.findByLabelText('Title'), 'My talk')
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      return { user }
    }

    it('attaches the duplicate-email message to the offending row email field', async () => {
      const { user } = await mountToSubmitStep()

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getByLabelText('Email'), 'speaker.a@example.com')
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getAllByLabelText('Email')[1]!, 'Speaker.A@Example.com')
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))

      const second = screen.getAllByLabelText('Email')[1]!
      expectLinkedError(second, /already listed/i)
      expect(screen.getAllByLabelText('First name')[0]).toHaveAttribute(
        'autocomplete',
        'section-cospeaker-1 given-name',
      )
      expect(screen.getAllByLabelText('Last name')[1]).toHaveAttribute(
        'autocomplete',
        'section-cospeaker-2 family-name',
      )
      expect(second).toHaveAttribute('autocomplete', 'section-cospeaker-2 email')
    })

    it('rejects a malformed co-speaker email on the row that holds it', async () => {
      const { user } = await mountToSubmitStep()

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getByLabelText('Email'), 'not-an-email')
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))

      expectLinkedError(screen.getAllByLabelText('Email')[0]!, /valid email/i)
    })
  })

  describe('form builder', () => {
    it('renders and links the empty-label error on the offending element', () => {
      render(
        <ElementEditor
          element={{
            id: 'e-1',
            eventId: EVENT_ID,
            versionId: VERSION_ID,
            pageId: 'p-1',
            position: 0,
            kind: 'question',
            fieldKey: 'title',
            label: '',
            required: true,
            maxLength: null,
            questionType: 'short_text',
            options: [],
            optionsSource: null,
          }}
          invalid
          onUpdate={() => undefined}
        />,
      )

      expectLinkedError(screen.getByLabelText('Label'), /label is required/i)
    })

    it('renders and links the empty condition-value error on the offending condition', () => {
      render(
        <ConditionRuleEditor
          rules={[
            {
              id: 'r-1',
              eventId: EVENT_ID,
              versionId: VERSION_ID,
              elementId: 'e-2',
              effect: 'show',
              position: 0,
              groups: [
                {
                  groupIndex: 0,
                  conditions: [{ operator: 'eq', operandKey: 'format', value: null }],
                },
              ],
            },
          ]}
          elements={[
            {
              id: 'e-1',
              eventId: EVENT_ID,
              versionId: VERSION_ID,
              pageId: 'p-1',
              position: 0,
              kind: 'question',
              fieldKey: 'format',
              label: 'Format',
              required: true,
              maxLength: null,
              questionType: 'single_choice',
              options: ['talk'],
              optionsSource: null,
            },
          ]}
          invalidConditionKey="r-1:0:0"
          registerValueRef={() => () => undefined}
          onUpdateRule={() => undefined}
        />,
      )

      expectLinkedError(screen.getByLabelText('Value'), /needs a value/i)
    })

    it('gives the operand and operator selects visible labels', () => {
      render(
        <ConditionRuleEditor
          rules={[
            {
              id: 'r-1',
              eventId: EVENT_ID,
              versionId: VERSION_ID,
              elementId: 'e-2',
              effect: 'show',
              position: 0,
              groups: [
                {
                  groupIndex: 0,
                  conditions: [{ operator: 'eq', operandKey: 'format', value: 'talk' }],
                },
              ],
            },
          ]}
          elements={[
            {
              id: 'e-1',
              eventId: EVENT_ID,
              versionId: VERSION_ID,
              pageId: 'p-1',
              position: 0,
              kind: 'question',
              fieldKey: 'format',
              label: 'Format',
              required: true,
              maxLength: null,
              questionType: 'single_choice',
              options: ['talk'],
              optionsSource: null,
            },
          ]}
          invalidConditionKey={null}
          registerValueRef={() => () => undefined}
          onUpdateRule={() => undefined}
        />,
      )

      expect(screen.getByText('Operand')).toBeInTheDocument()
      expect(screen.getByText('Operator')).toBeInTheDocument()
      expect(screen.getByLabelText('Operand')).toHaveAttribute('role', 'combobox')
      expect(screen.getByLabelText('Operator')).toHaveAttribute('role', 'combobox')
    })

    it('gives every routing rule its own Target label instead of one shared DOM id', () => {
      render(
        <RoutingRuleEditor
          rules={[
            {
              id: 'rr-1',
              eventId: EVENT_ID,
              versionId: VERSION_ID,
              position: 0,
              condition: { groups: [] },
              actionKind: 'assign_track',
              actionTarget: 'talk',
            },
            {
              id: 'rr-2',
              eventId: EVENT_ID,
              versionId: VERSION_ID,
              position: 1,
              condition: { groups: [] },
              actionKind: 'assign_tag',
              actionTarget: 'beginner',
            },
          ]}
          taxonomyItems={TAXONOMY_DTO.items as never}
          taxonomyUnavailable={false}
          onUpdateRule={() => undefined}
        />,
      )

      const targets = screen.getAllByLabelText('Target')
      expect(targets).toHaveLength(2)
      const first = targets[0]!.getAttribute('aria-labelledby')
      const second = targets[1]!.getAttribute('aria-labelledby')
      expect(first).toBeTruthy()
      expect(second).toBeTruthy()
      expect(first).not.toBe(second)
      expect(document.querySelectorAll('#routing-target-label')).toHaveLength(0)
    })
  })

  describe('builder preview', () => {
    it('renders the per-field validation message, not only a summary', async () => {
      const user = userEvent.setup()
      render(<PreviewEngine content={PREVIEW_CONTENT} taxonomyItems={[]} />)

      await user.click(screen.getByRole('button', { name: /submit preview/i }))

      expectLinkedError(screen.getByLabelText('Title'), /required/i)
    })
  })
})
