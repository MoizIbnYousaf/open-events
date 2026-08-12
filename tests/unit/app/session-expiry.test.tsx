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
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormDefinitionDto } from '../../../src/application'
import CfpWizard from '../../../src/app/features/public/CfpWizard'
import { publicDraftQueryKeys, useSaveDraft } from '../../../src/app/queries/public-drafts'

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
  opensAt: '2026-01-01T00:00:00.000Z',
  closesAt: '2026-12-31T23:59:59.000Z',
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

const SAVED_DRAFT = {
  id: 'draft-1',
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  formVersionId: VERSION_ID,
  title: 'My talk',
  answers: { format: 'talk', title: 'My talk' },
  updatedAt: '2026-08-08T10:00:00.000Z',
}

const SUBMISSION_DTO = {
  id: 'submission-1',
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
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

function deniedEnvelope(code: string): Response {
  return jsonResponse({ error: { code, message: code } }, code === 'unauthorized' ? 401 : 403)
}

const saveDriverRef: { mutateAsync: (() => Promise<unknown>) | null } = {
  mutateAsync: null,
}

function SaveDriver() {
  const save = useSaveDraft()
  useEffect(() => {
    saveDriverRef.mutateAsync = () => save.mutateAsync()
    return () => {
      saveDriverRef.mutateAsync = null
    }
  }, [save])
  return null
}

async function mountSaveSurface() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <CfpWizard form={PUBLISHED_FORM} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />
      <SaveDriver />
    </QueryClientProvider>,
  )
  return { queryClient, user }
}

async function advanceToSubmitStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /next/i }))
  await user.selectOptions(await screen.findByLabelText(/format/i), 'talk')
  await user.type(await screen.findByLabelText(/title/i), 'My talk')
  await user.click(screen.getByRole('button', { name: /next/i }))
  await user.click(screen.getByRole('button', { name: /next/i }))
  expect(await screen.findByRole('listitem', { name: /submit/i })).toHaveAttribute('aria-current')
}

async function mountSubmitSurface() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <CfpWizard form={PUBLISHED_FORM} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />
      <SaveDriver />
    </QueryClientProvider>,
  )
  await advanceToSubmitStep(user)
  return { queryClient, user }
}

function putCalls() {
  return fetchMock.mock.calls.filter(([input, init]) => {
    return requestUrl(input) === '/api/public/draft' && (init?.method ?? 'GET') === 'PUT'
  })
}

function postCalls() {
  return fetchMock.mock.calls.filter(([input, init]) => {
    return requestUrl(input) === '/api/public/submit' && (init?.method ?? 'GET') === 'POST'
  })
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
    }
    if (method === 'PUT' && url === '/api/public/draft') {
      return jsonResponse(SAVED_DRAFT)
    }
    if (method === 'POST' && url === '/api/public/submit') {
      return jsonResponse(SUBMISSION_DTO)
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
  saveDriverRef.mutateAsync = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('public session expiry', () => {
  it('renders the expired session state for a save PUT 401 with no Saved status', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return deniedEnvelope('unauthorized')
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { queryClient, user } = await mountSaveSurface()
    await waitFor(() => expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toBeDefined())
    const editorBefore = queryClient.getQueryData(publicDraftQueryKeys.editor)
    const activeBefore = queryClient.getQueryData(publicDraftQueryKeys.activeDraft(FORM_ID))
    const clearSpy = vi.spyOn(queryClient, 'clear')
    await user.click(await screen.findByRole('button', { name: /save/i }))

    expect(putCalls()).toHaveLength(1)
    expect(postCalls()).toHaveLength(0)
    expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toEqual(editorBefore)
    expect(queryClient.getQueryData(publicDraftQueryKeys.activeDraft(FORM_ID))).toEqual(
      activeBefore,
    )
    expect(clearSpy).not.toHaveBeenCalled()
    clearSpy.mockRestore()
    expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    // The refusal REPLACES the page. It used to render into the save bar's own
    // slot, leaving a second h1 under a wizard that was still editable and
    // could no longer save anything.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Call for papers' })).not.toBeInTheDocument()
  })

  it('renders the expired session state for a submit POST 401 with no confirmation', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return jsonResponse(SAVED_DRAFT)
      }
      if (method === 'POST' && url === '/api/public/submit') {
        return deniedEnvelope('unauthorized')
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { queryClient, user } = await mountSubmitSurface()
    await saveDriverRef.mutateAsync?.()
    await waitFor(() => expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toBeDefined())
    const editorBefore = queryClient.getQueryData(publicDraftQueryKeys.editor)
    const activeBefore = queryClient.getQueryData(publicDraftQueryKeys.activeDraft(FORM_ID))
    const clearSpy = vi.spyOn(queryClient, 'clear')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(postCalls()).toHaveLength(1)
    expect(putCalls()).toHaveLength(1)
    expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toEqual(editorBefore)
    expect(queryClient.getQueryData(publicDraftQueryKeys.activeDraft(FORM_ID))).toEqual(
      activeBefore,
    )
    expect(clearSpy).not.toHaveBeenCalled()
    clearSpy.mockRestore()
    expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Submission received' })).not.toBeInTheDocument()
  })

  // A 403 on the SAVE or the SUBMIT is an organizer following their own
  // public link, and both surfaces now answer through the same page state —
  // a way into their own workspace, never a second dead-end card stacked
  // under a wizard that can no longer send anything.
  it.each([
    ['save', 'This form saves proposals for speakers'],
    ['submit', 'This form saves proposals for speakers'],
  ] as const)(
    'renders a forbidden page state for a 403 on %s without the expired state',
    async (surface, heading) => {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        if (method === 'PUT' && url === '/api/public/draft') {
          if (surface === 'save') return deniedEnvelope('forbidden')
          return jsonResponse(SAVED_DRAFT)
        }
        if (method === 'POST' && url === '/api/public/submit') {
          if (surface === 'submit') return deniedEnvelope('forbidden')
          return jsonResponse(SUBMISSION_DTO)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      if (surface === 'save') {
        const { queryClient, user } = await mountSaveSurface()
        await waitFor(() =>
          expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toBeDefined(),
        )
        const editorBefore = queryClient.getQueryData(publicDraftQueryKeys.editor)
        const clearSpy = vi.spyOn(queryClient, 'clear')
        await user.click(await screen.findByRole('button', { name: /save/i }))
        expect(putCalls()).toHaveLength(1)
        expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toEqual(editorBefore)
        expect(clearSpy).not.toHaveBeenCalled()
        clearSpy.mockRestore()
      } else {
        const { queryClient, user } = await mountSubmitSurface()
        await saveDriverRef.mutateAsync?.()
        await waitFor(() =>
          expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toBeDefined(),
        )
        const editorBefore = queryClient.getQueryData(publicDraftQueryKeys.editor)
        const clearSpy = vi.spyOn(queryClient, 'clear')
        await user.click(screen.getByRole('button', { name: /submit/i }))
        expect(postCalls()).toHaveLength(1)
        expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toEqual(editorBefore)
        expect(clearSpy).not.toHaveBeenCalled()
        clearSpy.mockRestore()
      }

      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Session expired' })).not.toBeInTheDocument()
      // RV1-N2: one state answers both refusals, so its sentence names the
      // identity rather than the operation. "cannot hold a speaker's draft"
      // described a save to a reader who had just pressed Submit.
      expect(
        screen.getByText(
          /A proposal belongs to a speaker session, and yours is an organizer one\./,
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText(/speaker's draft/i)).not.toBeInTheDocument()
      // The way forward is the same on both legs, so it is asserted on both.
      expect(screen.getByRole('link', { name: /organizer workspace/i })).toHaveAttribute(
        'href',
        '/admin',
      )
    },
  )

  it('never renders the raw server message in expired or forbidden states', async () => {
    for (const [code, status, rawMessage] of [
      ['unauthorized', 401, 'Session Revoked'],
      ['forbidden', 403, 'Access Denied'],
    ] as const) {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        if (method === 'PUT' && url === '/api/public/draft') {
          return jsonResponse({ error: { code, message: rawMessage } }, status)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      const { user } = await mountSaveSurface()
      await user.click(await screen.findByRole('button', { name: /save/i }))

      const rendered = document.body.textContent ?? ''
      expect(rendered).not.toContain(rawMessage)
      cleanup()
    }
  })

  it('fires exactly one failed mutation after a 401 and no follow-on writes', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return deniedEnvelope('unauthorized')
      }
      if (method === 'POST' && url === '/api/public/submit') {
        return deniedEnvelope('unauthorized')
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { user } = await mountSaveSurface()
    await user.click(await screen.findByRole('button', { name: /save/i }))
    expect(putCalls()).toHaveLength(1)
    expect(postCalls()).toHaveLength(0)
    expect(await screen.findByRole('heading', { name: 'Session expired' })).toBeInTheDocument()
  })

  it('invokes a recovery handler targeting /start when Sign in again is clicked', async () => {
    // Reached the way a real speaker reaches it: the optional draft probe says
    // "no draft", the speaker writes, and the SAVE is the request that finds
    // the session gone. A refused first probe is not an expired session.
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return deniedEnvelope('unauthorized')
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const rootRoute = createRootRoute()
    const wizardRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/cfp/$eventSlug/$formSlug',
      component: () => (
        <CfpWizard form={PUBLISHED_FORM} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />
      ),
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([wizardRoute]),
      history: createMemoryHistory({ initialEntries: [`/cfp/${EVENT_SLUG}/${FORM_SLUG}`] }),
    })
    await router.load()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    await user.click(await screen.findByRole('button', { name: /^save$/i }))
    await screen.findByRole('heading', { name: 'Session expired' })

    const navigateSpy = vi.spyOn(router, 'navigate')
    await user.click(screen.getByRole('button', { name: /sign in again/i }))
    expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '/start' }))
    navigateSpy.mockRestore()
  })

  it('clears only the public draft query keys on recovery without calling queryClient.clear', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return deniedEnvelope('unauthorized')
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { queryClient, user } = await mountSaveSurface()
    await user.click(await screen.findByRole('button', { name: /^save$/i }))
    await screen.findByRole('heading', { name: 'Session expired' })

    const clearSpy = vi.spyOn(queryClient, 'clear')
    const removeSpy = vi.spyOn(queryClient, 'removeQueries')
    const sentinelKey = ['admin', 'events', EVENT_SLUG] as const
    queryClient.setQueryData(sentinelKey, { sentinel: true })

    await userEvent.setup().click(screen.getByRole('button', { name: /sign in again/i }))

    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: publicDraftQueryKeys.editor,
      exact: true,
    })
    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: publicDraftQueryKeys.activeDraft(FORM_ID),
      exact: true,
    })
    expect(
      removeSpy.mock.calls.every(([options]) => {
        const key = options?.queryKey
        return (
          options?.exact === true &&
          (JSON.stringify(key) === JSON.stringify(publicDraftQueryKeys.editor) ||
            JSON.stringify(key) === JSON.stringify(publicDraftQueryKeys.activeDraft(FORM_ID)))
        )
      }),
    ).toBe(true)
    expect(queryClient.getQueryData(sentinelKey)).toEqual({ sentinel: true })
    expect(clearSpy).not.toHaveBeenCalled()
    removeSpy.mockRestore()
    clearSpy.mockRestore()
  })

  it('preserves the editor cache on 403, 404, 409, and 5xx errors', async () => {
    for (const [code, status] of [
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
      ['internal', 500],
    ] as const) {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        if (method === 'PUT' && url === '/api/public/draft') {
          return jsonResponse({ error: { code, message: code } }, status)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      const { queryClient } = await mountSaveSurface()
      const callsBefore = putCalls().length
      await waitFor(() =>
        expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toBeDefined(),
      )
      const editorBefore = queryClient.getQueryData(publicDraftQueryKeys.editor)
      await userEvent.setup().click(await screen.findByRole('button', { name: /save/i }))
      await waitFor(() => expect(putCalls().length).toBe(callsBefore + 1))
      expect(putCalls().length).toBe(callsBefore + 1)
      expect(queryClient.getQueryData(publicDraftQueryKeys.editor)).toEqual(editorBefore)
      await screen.findByRole('alert')
      cleanup()
    }
  })
})

/**
 * A refused save has three different meanings and the page owes each of them a
 * different whole answer — never a second card stacked under a wizard that can
 * no longer save. The probe is what tells them apart: GET /api/public/draft is
 * session-guarded, so an answer of any kind proves a session existed and a
 * refusal proves it did not.
 */
describe('a refused save replaces the wizard with one honest page state', () => {
  function deniedProbeHandler(probe: 'unauthorized' | 'forbidden') {
    return (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return deniedEnvelope(probe)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return deniedEnvelope(probe)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  }

  function assertOnePageState() {
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // The wizard is gone, not merely pushed above the card: no step controls,
    // no title field, nothing left to type into that cannot be saved.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Call for papers' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/proposal title/i)).not.toBeInTheDocument()
  }

  it('tells a visitor who never had a session to identify themselves, not that it expired', async () => {
    fetchHandler = deniedProbeHandler('unauthorized')
    const { user } = await mountSaveSurface()
    // The refused probe means "no draft", so the call for papers renders.
    await screen.findByRole('heading', { level: 1, name: 'Call for papers' })
    await user.click(await screen.findByRole('button', { name: /^save$/i }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Identify yourself to save your proposal',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Session expired' })).not.toBeInTheDocument()
    expect(screen.getByText(/nothing you have typed here has been stored yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /speaker sign-in/i })).toHaveAttribute('href', '/start')
    assertOnePageState()
  })

  it('sends an organizer refused with 403 to their own workspace', async () => {
    fetchHandler = deniedProbeHandler('forbidden')
    const { user } = await mountSaveSurface()
    await screen.findByRole('heading', { level: 1, name: 'Call for papers' })
    await user.click(await screen.findByRole('button', { name: /^save$/i }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This form saves proposals for speakers',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /organizer workspace/i })).toHaveAttribute(
      'href',
      '/admin',
    )
    assertOnePageState()
  })

  it('keeps the genuine expiry for a speaker whose probe had answered', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return deniedEnvelope('unauthorized')
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { user } = await mountSaveSurface()
    await user.click(await screen.findByRole('button', { name: /^save$/i }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Session expired' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Identify yourself to save your proposal' }),
    ).not.toBeInTheDocument()
    assertOnePageState()
  })
})
