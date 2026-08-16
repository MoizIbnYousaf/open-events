import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormDefinitionDto } from '../../../src/application'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'
import { DeniedState } from '../../../src/app/features/admin/AdminStates'
import { Route as RootRoute } from '../../../src/app/routes/__root'
import CfpSubmit from '../../../src/app/features/public/CfpSubmit'
import CfpWizard from '../../../src/app/features/public/CfpWizard'
import StartForm from '../../../src/app/features/public/StartForm'

const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
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

function renderInProvider(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

beforeEach(() => {
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

describe('public form accessibility', () => {
  it('inherits the shell at a public URL: skip link present and main#main tabIndex -1', async () => {
    const startStub = createRoute({
      getParentRoute: () => RootRoute,
      path: '/start',
      component: () => <div>stub</div>,
    })
    const router = createRouter({
      routeTree: RootRoute.addChildren([startStub]),
      history: createMemoryHistory({ initialEntries: ['/start'] }),
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

    await screen.findByText('Open Events')
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    const main = document.getElementById('main')
    expect(main).not.toBeNull()
    expect(main).toHaveAttribute('tabindex', '-1')
  })

  it('renders exactly one page h1 on the standalone speaker access form', () => {
    renderInProvider(<StartForm eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Speaker access')
    expect(headings[0]).not.toHaveTextContent('Open Events')
  })

  it('renders exactly one page h1 as the CFP first heading with no h2 before it', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderInProvider(
      <CfpWizard form={PUBLISHED_FORM} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />,
    )

    await screen.findByRole('button', { name: /next/i })
    const headings = screen.getAllByRole('heading')
    expect(headings[0]?.tagName).toBe('H1')
    expect(headings[0]).not.toHaveTextContent('Open Events')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('drives the real submission to confirmation and renders exactly one h1 (Submission received)', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'POST' && url === '/api/public/submit') {
        return jsonResponse({
          id: 'submission-1',
          eventId: EVENT_ID,
          formId: FORM_ID,
          formSlug: FORM_SLUG,
          versionId: VERSION_ID,
          version: 1,
          status: 'pending',
          title: 'My talk',
          answers: { format: 'talk', title: 'My talk' },
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
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(['public', 'editor'], {
      formId: FORM_ID,
      formVersionId: VERSION_ID,
      draftId: 'draft-1',
      title: 'My talk',
      answers: { format: 'talk', title: 'My talk' },
      dirty: false,
      reloadIntent: false,
      coSpeakers: [],
    })
    render(
      <QueryClientProvider client={queryClient}>
        <CfpSubmit formVersionId={VERSION_ID} onDenied={() => undefined} />
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: /submit/i }))
    await screen.findByText('Submission received')

    const headings = screen.getAllByRole('heading')
    expect(headings[0]?.tagName).toBe('H1')
    expect(headings[0]).toHaveTextContent('Submission received')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('announces a sanitized not-found state via the DeniedState h1 and role=alert', () => {
    renderInProvider(<DeniedState />)

    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be found/i)
  })

  it('exposes a labeled keyboard-usable Save control that disables while pending', async () => {
    const user = userEvent.setup()
    let resolveSave: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return new Promise<Response>((resolve) => {
          resolveSave = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderInProvider(
      <CfpWizard form={PUBLISHED_FORM} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />,
    )

    const save = await screen.findByRole('button', { name: /save/i })
    expect(save).toBeEnabled()
    await user.click(save)
    expect(await screen.findByRole('button', { name: /saving/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    resolveSave?.(
      jsonResponse({
        id: 'draft-1',
        eventId: EVENT_ID,
        formVersionId: VERSION_ID,
        title: 'My talk',
        answers: { format: 'talk', title: 'My talk' },
        updatedAt: '2026-08-08T10:00:00.000Z',
      }),
    )
    expect(await screen.findByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('keeps the heading hierarchy: no h2 appears before the first h1 on the start surface', () => {
    renderInProvider(<StartForm eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    const headings = screen.getAllByRole('heading')
    const firstHeading = headings[0]
    expect(firstHeading).toBeDefined()
    expect(firstHeading?.tagName).toBe('H1')
  })

  it('allows a bounded explicit Tab order on the start surface without a focus trap', async () => {
    const user = userEvent.setup()
    renderInProvider(<StartForm eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />)

    const email = screen.getByLabelText(/email/i)
    await waitFor(() => expect(email).toHaveFocus())
    await user.tab()
    expect(screen.getByRole('button', { name: /request a link/i })).toHaveFocus()
    await user.tab()
    expect(document.activeElement).toBe(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
