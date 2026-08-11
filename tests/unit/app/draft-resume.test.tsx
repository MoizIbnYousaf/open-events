import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DraftDto, FormDefinitionDto } from '../../../src/application'
import { getActiveDraft, saveDraft } from '../../../src/app/api/public'
import CfpSaveBar from '../../../src/app/features/public/CfpSaveBar'
import CfpWizard from '../../../src/app/features/public/CfpWizard'
import {
  publicDraftQueryKeys,
  useActiveDraft,
  useSaveDraft,
} from '../../../src/app/queries/public-drafts'

const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'
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
  conditionRules: [
    {
      id: 'r-1',
      elementId: 'e-2',
      effect: 'show',
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'format', value: 'workshop' }],
        },
      ],
      position: 0,
    },
    {
      id: 'r-2',
      elementId: 'e-4',
      effect: 'require',
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'format', value: 'workshop' }],
        },
      ],
      position: 1,
    },
  ],
}

const ACTIVE_DRAFT: DraftDto = {
  id: 'draft-1',
  eventId: EVENT_ID,
  formVersionId: VERSION_ID,
  title: 'Resumed talk',
  answers: { format: 'talk', title: 'Resumed talk' },
  updatedAt: '2026-08-08T10:00:00.000Z',
}

const SAVED_DRAFT: DraftDto = {
  ...ACTIVE_DRAFT,
  updatedAt: '2026-08-08T10:05:00.000Z',
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

function renderDraftUi() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <CfpWizard form={PUBLISHED_FORM} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
      return jsonResponse(ACTIVE_DRAFT)
    }
    if (method === 'PUT' && url === '/api/public/draft') {
      return jsonResponse(SAVED_DRAFT)
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

describe('public CFP draft save and resume', () => {
  it('exposes the intended draft module surface', () => {
    expect(CfpSaveBar).toBeTypeOf('function')
    expect(useActiveDraft).toBeTypeOf('function')
    expect(useSaveDraft).toBeTypeOf('function')
    // src/app/api/public.ts exists; these are absent EXPORTS from that module.
    expect(getActiveDraft).toBeTypeOf('function')
    expect(saveDraft).toBeTypeOf('function')
    expect(ACTIVE_DRAFT.answers).toEqual({ format: 'talk', title: 'Resumed talk' })
  })

  it('resumes and hydrates the active draft answers and title', async () => {
    renderDraftUi()

    await userEvent.setup().click(await screen.findByRole('button', { name: /next/i }))
    const format = await screen.findByLabelText(/format/i)
    expect(format).toHaveValue('talk')
    expect(await screen.findByLabelText(/title/i)).toHaveValue('Resumed talk')
    // The step's first field (Format) receives focus; hydration must not
    // steal it away to the body.
    expect(format).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('disables the save button with Saving… while pending and shows saved feedback', async () => {
    const user = userEvent.setup()
    let resolveSave: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse(ACTIVE_DRAFT)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return new Promise<Response>((resolve) => {
          resolveSave = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderDraftUi()

    await user.click(await screen.findByRole('button', { name: /save/i }))
    const saving = await screen.findByRole('button', { name: /saving/i })
    expect(saving).toHaveAttribute('aria-disabled', 'true')
    // The in-flight state is on the control AND in a status region: aria-busy
    // alone is not reliably announced.
    expect(saving).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/saving your draft/i)
    resolveSave?.(jsonResponse(SAVED_DRAFT))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/))
    expect(await screen.findByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('sends SaveDraftInput with the resumed draft id and reuses it on the next save', async () => {
    const user = userEvent.setup()
    renderDraftUi()

    await user.click(await screen.findByRole('button', { name: /save/i }))
    await screen.findByRole('status')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByRole('status')

    const putBodies = fetchMock.mock.calls
      .filter(([input, init]) => {
        return requestUrl(input) === '/api/public/draft' && (init?.method ?? 'GET') === 'PUT'
      })
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
    expect(putBodies).toHaveLength(2)
    expect(putBodies[0]).toMatchObject({
      id: 'draft-1',
      formId: FORM_ID,
      formVersionId: VERSION_ID,
    })
    expect(putBodies[1]?.id).toBe('draft-1')
  })

  it('renders a 409 conflict with reload and never silently overwrites or auto-retries', async () => {
    const user = userEvent.setup()
    let putCount = 0
    let draftGetCount = 0
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        draftGetCount += 1
        return jsonResponse(ACTIVE_DRAFT)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        putCount += 1
        if (putCount === 1) {
          return jsonResponse({ error: { code: 'conflict', message: 'Conflict' } }, 409)
        }
        return jsonResponse(SAVED_DRAFT)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderDraftUi()

    // Title lives on p-2; reach it via the same Next transition as resume.
    await user.click(await screen.findByRole('button', { name: /next/i }))
    // Make a local title edit before the conflict save.
    const title = await screen.findByLabelText(/title/i)
    await user.clear(title)
    await user.type(title, 'Edited title')
    await user.click(await screen.findByRole('button', { name: /save/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    const putCalls = () =>
      fetchMock.mock.calls.filter(([input, init]) => {
        return requestUrl(input) === '/api/public/draft' && (init?.method ?? 'GET') === 'PUT'
      })
    expect(putCalls()).toHaveLength(1)
    const getsBeforeReload = draftGetCount

    // Deterministically establish the user's focused field before reload.
    await user.click(title)
    expect(title).toHaveFocus()

    await user.click(await screen.findByRole('button', { name: /reload latest/i }))
    // The refetch must complete before the hydration/focus assertions run.
    await waitFor(() => {
      expect(screen.getByLabelText(/format/i)).toHaveValue('talk')
      expect(title).toHaveValue('Resumed talk')
      // Exactly one fresh draft GET on reload and zero additional PUTs.
      expect(draftGetCount).toBe(getsBeforeReload + 1)
      expect(putCalls()).toHaveLength(1)
      // Reload hydrates without stealing focus from the user-focused field.
      expect(title).toHaveFocus()
      expect(document.activeElement).not.toBe(document.body)
    })
    // Reload discards local edits, so dirty is cleared: beforeunload must not
    // be prevented after the successful reload.
    const afterReloadEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterReloadEvent)
    expect(afterReloadEvent.defaultPrevented).toBe(false)
  })

  it('treats a 404 (no active draft) as a fresh empty form', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return jsonResponse(SAVED_DRAFT)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderDraftUi()

    await userEvent.setup().click(await screen.findByRole('button', { name: /next/i }))
    expect(await screen.findByLabelText(/format/i)).toHaveValue('')
    expect(await screen.findByLabelText(/title/i)).toHaveValue('')
  })

  // The draft probe is optional, so a refusal has two entirely different
  // meanings and the page owes each of them a different answer. Both are
  // pinned here: the FIRST refusal is "you have no draft", a LATER one is
  // "your session died while you were writing".
  it.each([
    { status: 401, code: 'unauthorized', heading: 'Session expired' },
    { status: 403, code: 'forbidden', heading: 'Access forbidden' },
  ] as const)(
    'renders the production denial state for a $status draft GET once the probe has answered',
    async ({ status, code, heading }) => {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse(ACTIVE_DRAFT)
        }
        if (method === 'PUT' && url === '/api/public/draft') {
          return jsonResponse(SAVED_DRAFT)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      const { queryClient } = renderDraftUi()
      // The probe answered once, so this reader demonstrably HAD a session.
      await screen.findByRole('button', { name: /next/i })
      await waitFor(() =>
        expect(
          queryClient.getQueryData(publicDraftQueryKeys.activeDraft(FORM_ID)),
        ).not.toBeUndefined(),
      )

      // The session dies mid-draft: the same probe now refuses.
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code, message: heading } }, status)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      await queryClient.refetchQueries({ queryKey: publicDraftQueryKeys.activeDraft(FORM_ID) })

      expect(await screen.findByText(heading)).toBeInTheDocument()
      if (heading === 'Session expired') {
        expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
      }
      for (const other of ['Session expired', 'Access forbidden', 'Not found']) {
        if (other !== heading) {
          expect(screen.queryByText(other)).not.toBeInTheDocument()
        }
      }
      expect(screen.queryByText('Not found')).not.toBeInTheDocument()
    },
  )

  it.each([
    { status: 401, code: 'unauthorized', label: 'a visitor with no session' },
    { status: 403, code: 'forbidden', label: 'an organizer following their own public link' },
  ] as const)(
    'renders the call for papers when the first draft probe is refused ($status, $label)',
    async ({ status, code }) => {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code, message: code } }, status)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      renderDraftUi()

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Call for papers' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
      for (const deadEnd of ['Session expired', 'Access forbidden', 'Unable to load your draft.']) {
        expect(screen.queryByText(deadEnd)).not.toBeInTheDocument()
      }
    },
  )

  it('still surfaces a retry when the first draft probe fails for a reason that is not a refusal', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    renderDraftUi()

    expect(await screen.findByText('Unable to load your draft.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('arms the dirty beforeunload guard only after editing', async () => {
    const user = userEvent.setup()
    renderDraftUi()

    const cleanEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)

    await user.click(await screen.findByRole('button', { name: /next/i }))
    const title = await screen.findByLabelText(/title/i)
    await user.clear(title)
    await user.type(title, 'Edited title')

    const dirtyEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)
  })

  it('makes no unrelated fetch calls beyond the draft GET and PUT', async () => {
    const user = userEvent.setup()
    renderDraftUi()

    // Title lives on p-2; reach it via the same Next transition as resume.
    await user.click(await screen.findByRole('button', { name: /next/i }))
    await screen.findByLabelText(/title/i)
    const draftGetCalls = fetchMock.mock.calls.filter(([input, init]) => {
      return (
        requestUrl(input) === `/api/public/draft?formId=${FORM_ID}` &&
        (init?.method ?? 'GET') === 'GET'
      )
    })
    expect(draftGetCalls).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByRole('status')

    const allowed = new Set([`/api/public/draft?formId=${FORM_ID}`, '/api/public/draft'])
    for (const [input] of fetchMock.mock.calls) {
      expect(allowed.has(requestUrl(input))).toBe(true)
    }
  })
})
