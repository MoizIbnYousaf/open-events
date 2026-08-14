import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TasksPanel from '../../../src/app/features/public/TasksPanel'

// O1 portal contract: a form-backed task renders the REAL published form for
// its pinned version — fetched from the task's own form endpoint — and
// completes only through a validated answers submission. A pending form task
// never shows a bare "Mark complete" control, and a server rejection keeps
// the task pending with a generic error. No dead controls, no fake success.

const TASKS_URL = '/api/public/tasks'
const TASK_ID = 'task-form-1'
const FORM_URL = `/api/public/tasks/${TASK_ID}/form`
const COMPLETE_URL = `/api/public/tasks/${TASK_ID}/complete`

const FORM_TASK = {
  id: TASK_ID,
  kind: 'complete_form',
  submissionTitle: 'My talk',
  status: 'pending',
  completedAt: null,
}

const DEFINITION = {
  formId: 'form-av',
  formSlug: 'av-requirements',
  eventSlug: 'demo-conf-2026',
  versionId: 'version-av-1',
  version: 1,
  status: 'published',
  contentHash: 'hash',
  publishedAt: '2026-05-01T09:00:00.000Z',
  pages: [{ id: 'page-1', position: 0, kind: 'info', title: 'AV', content: '' }],
  elements: [
    {
      id: 'element-av',
      pageId: 'page-1',
      position: 0,
      kind: 'question',
      fieldKey: 'av_needs',
      label: 'What A/V setup do you need?',
      required: true,
      maxLength: 200,
      questionType: 'short_text',
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

beforeEach(() => {
  fetchHandler = () =>
    jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(fetchHandler(requestUrl(input), init)),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function withDefinition(
  onComplete: (init?: RequestInit) => Response | Promise<Response>,
): typeof fetchHandler {
  return (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === TASKS_URL) return jsonResponse([FORM_TASK])
    if (method === 'GET' && url === FORM_URL) return jsonResponse(DEFINITION)
    if (method === 'POST' && url === COMPLETE_URL) return onComplete(init)
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <TasksPanel />
    </QueryClientProvider>,
  )
}

async function openForm(): Promise<void> {
  const open = await screen.findByRole('button', { name: /fill out form/i })
  await userEvent.click(open)
}

describe('portal form task', () => {
  it('shows the form task with no bare mark-complete control', async () => {
    fetchHandler = withDefinition(() => jsonResponse({ ...FORM_TASK, status: 'completed' }))
    renderPanel()
    expect(await screen.findByText(/fill out the assigned form/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^mark complete/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fill out form/i })).toBeInTheDocument()
  })

  it('renders the real published field when opened', async () => {
    fetchHandler = withDefinition(() => jsonResponse({ ...FORM_TASK, status: 'completed' }))
    renderPanel()
    await openForm()
    expect(await screen.findByLabelText(/what a\/v setup do you need\?/i)).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) => requestUrl(input as RequestInfo) === FORM_URL),
    ).toBe(true)
  })

  it('submits the typed answers as the completion payload', async () => {
    let completeBody: unknown
    fetchHandler = withDefinition((init) => {
      completeBody = JSON.parse(String(init?.body))
      return jsonResponse({
        ...FORM_TASK,
        status: 'completed',
        response: { av_needs: 'Two mics' },
      })
    })
    renderPanel()
    await openForm()
    await userEvent.type(await screen.findByLabelText(/what a\/v setup/i), 'Two mics')
    await userEvent.click(screen.getByRole('button', { name: /submit form/i }))
    await waitFor(() => expect(completeBody).toEqual({ answers: { av_needs: 'Two mics' } }))
    expect(await screen.findByText(/complete/i)).toBeInTheDocument()
  })

  it('keeps a required form task local until its required answer is present', async () => {
    fetchHandler = withDefinition(() =>
      jsonResponse({ ...FORM_TASK, status: 'completed', response: { av_needs: '' } }),
    )
    renderPanel()
    await openForm()
    await userEvent.click(await screen.findByRole('button', { name: /submit form/i }))

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([input]) => requestUrl(input as RequestInfo) === COMPLETE_URL),
    ).toHaveLength(0)
  })

  it('keeps the task pending and shows a generic error when the server rejects', async () => {
    fetchHandler = withDefinition(() =>
      jsonResponse({ error: { code: 'validation_failed', message: 'raw server wording' } }, 400),
    )
    renderPanel()
    await openForm()
    await userEvent.type(await screen.findByLabelText(/what a\/v setup/i), 'x')
    await userEvent.click(screen.getByRole('button', { name: /submit form/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(/raw server wording/)
    expect(screen.getByRole('button', { name: /submit form/i })).toBeInTheDocument()
    expect(screen.getByText(/outstanding/i)).toBeInTheDocument()
  })
})
