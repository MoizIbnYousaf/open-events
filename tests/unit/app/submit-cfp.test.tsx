import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormDefinitionDto } from '../../../src/application'
import CfpSubmit from '../../../src/app/features/public/CfpSubmit'
import CfpWizard from '../../../src/app/features/public/CfpWizard'
import { useSaveDraft } from '../../../src/app/queries/public-drafts'

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

/** Test-only non-rendering save driver: calls the committed useSaveDraft
 *  mutation to acquire draftId with exactly one prerequisite draft PUT. */
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

async function mountWizard() {
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

async function saveDraftOnce() {
  await saveDriverRef.mutateAsync?.()
}

function submitCalls() {
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
      return jsonResponse({
        id: 'draft-1',
        eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
        formVersionId: VERSION_ID,
        title: 'My talk',
        answers: { format: 'talk', title: 'My talk' },
        updatedAt: '2026-08-08T10:00:00.000Z',
      })
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

describe('public CFP submit and confirmation', () => {
  describe('module surface', () => {
    it('exposes CfpSubmit as a function without rendering', () => {
      expect(CfpSubmit).toBeTypeOf('function')
    })
  })

  describe('wizard integration', () => {
    it('shows no submit control before the submit step and shows it on the submit step', async () => {
      const { user } = await mountWizard()

      await user.click(await screen.findByRole('button', { name: /next/i }))
      expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()

      await user.selectOptions(await screen.findByLabelText(/format/i), 'talk')
      await user.type(await screen.findByLabelText(/title/i), 'My talk')
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      expect(await screen.findByRole('listitem', { name: /submit/i })).toHaveAttribute(
        'aria-current',
      )
      expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
    })

    it('disables the submit control until the draft is saved and enables it after', async () => {
      const { user } = await mountWizard()
      await advanceToSubmitStep(user)

      expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
      await saveDraftOnce()
      await waitFor(() => expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled())
    })

    it('shows Submitting… and sends exactly one POST while the submit is pending', async () => {
      const { user } = await mountWizard()
      await advanceToSubmitStep(user)
      await saveDraftOnce()
      let resolveSubmit: ((response: Response) => void) | undefined
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        if (method === 'PUT' && url === '/api/public/draft') {
          return jsonResponse({
            id: 'draft-1',
            eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
            formVersionId: VERSION_ID,
            title: 'My talk',
            answers: { format: 'talk', title: 'My talk' },
            updatedAt: '2026-08-08T10:00:00.000Z',
          })
        }
        if (method === 'POST' && url === '/api/public/submit') {
          return new Promise<Response>((resolve) => {
            resolveSubmit = resolve
          })
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }

      await user.click(screen.getByRole('button', { name: /submit/i }))
      expect(await screen.findByRole('button', { name: /submitting/i })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      expect(submitCalls()).toHaveLength(1)
      resolveSubmit?.(jsonResponse(SUBMISSION_DTO))
      await screen.findByRole('status')
    })

    it('does not fire additional POSTs after a successful submit', async () => {
      const { user } = await mountWizard()
      await advanceToSubmitStep(user)
      await saveDraftOnce()

      await user.click(screen.getByRole('button', { name: /submit/i }))
      await screen.findByRole('status')
      expect(submitCalls()).toHaveLength(1)
      expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
    })

    it('shows a generic status confirmation with heading focus, clears dirty, resets caches, and leaks no ids', async () => {
      const { queryClient, user } = await mountWizard()
      await advanceToSubmitStep(user)
      await saveDraftOnce()

      await user.click(screen.getByRole('button', { name: /submit/i }))
      // The outcome is said ONCE: the h1 names it and takes focus, and the
      // status region beneath carries the explanation instead of repeating the
      // title back at the speaker (R1-m9). The region is still what marks the
      // confirmation programmatically.
      const status = await screen.findByRole('status')
      expect(status).toHaveTextContent(/with the organizers/i)
      // Unanchored on purpose: the rule is that the region never repeats the
      // title back, wherever in the sentence it would land. The `^` made the
      // check pass for any echo that was not the first word.
      expect(status).not.toHaveTextContent(/submission received/i)
      const heading = await screen.findByRole('heading', { name: /submission received/i })
      expect(heading).toHaveFocus()

      const afterSuccessEvent = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(afterSuccessEvent)
      expect(afterSuccessEvent.defaultPrevented).toBe(false)

      const editor = queryClient.getQueryData<{
        readonly draftId: string | null
        readonly dirty: boolean
        readonly coSpeakers: readonly unknown[]
      }>(['public', 'editor'])
      expect(editor?.draftId).toBeNull()
      expect(editor?.dirty).toBe(false)
      expect(editor?.coSpeakers).toEqual([])
      expect(queryClient.getQueryData(['public', 'draft', FORM_ID])).toBeNull()
      const rendered = document.body.textContent ?? ''
      expect(rendered).not.toContain('submission-1')
      expect(rendered).not.toContain('speaker.a@example.test')
      expect(rendered).not.toContain('draft-1')
      expect(rendered).not.toContain('token')
    })

    it('renders exactly one confirmation h1 and hides the Call for papers h1', async () => {
      const { user } = await mountWizard()
      await advanceToSubmitStep(user)
      await saveDraftOnce()

      await user.click(screen.getByRole('button', { name: /submit/i }))
      await screen.findByRole('heading', { name: 'Submission received' })

      const h1s = screen.getAllByRole('heading', { level: 1 })
      expect(h1s).toHaveLength(1)
      expect(h1s[0]).toHaveTextContent('Submission received')
      expect(screen.queryByRole('heading', { name: 'Call for papers' })).not.toBeInTheDocument()

      // The whole pre-submit surface is gone: no stepper navigation, save bar,
      // co-speaker editor, or submit control around the confirmation.
      expect(screen.queryByRole('navigation', { name: /form steps/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /add co-speaker/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
      // V7-CONFIRM-NEXT: not a dead end. The one thing left to press goes to
      // the surface that lists what the speaker just sent.
      expect(screen.getByRole('link', { name: /speaker portal/i })).toHaveAttribute(
        'href',
        '/portal',
      )
    })

    it('replaces the wizard with one expired-session page when the submit is refused 401', async () => {
      const { user } = await mountWizard()
      await advanceToSubmitStep(user)
      await saveDraftOnce()
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        if (method === 'POST' && url === '/api/public/submit') {
          return jsonResponse({ error: { code: 'unauthorized', message: 'Session expired' } }, 401)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }

      await user.click(screen.getByRole('button', { name: /submit/i }))
      await screen.findByRole('heading', { name: 'Session expired' })

      // One page state, once: a refused submit must not stack a dead-end card
      // under a wizard that is still editable and cannot submit (V-B1/B2's
      // anatomy, one control further along).
      const h1s = screen.getAllByRole('heading', { level: 1 })
      expect(h1s).toHaveLength(1)
      expect(h1s[0]).toHaveTextContent('Session expired')
      expect(screen.queryByRole('heading', { name: 'Call for papers' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    })

    it('replaces the wizard with the organizer page when the submit is refused 403', async () => {
      const { user } = await mountWizard()
      await advanceToSubmitStep(user)
      await saveDraftOnce()
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        if (method === 'POST' && url === '/api/public/submit') {
          return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }

      await user.click(screen.getByRole('button', { name: /submit/i }))
      await screen.findByRole('heading', { name: /saves proposals for speakers/i })

      const h1s = screen.getAllByRole('heading', { level: 1 })
      expect(h1s).toHaveLength(1)
      expect(screen.queryByRole('heading', { name: 'Call for papers' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
    })

    it('sends the exact SubmitInput payload with normalized co-speakers and omits empty emails', async () => {
      const { user } = await mountWizard()
      await advanceToSubmitStep(user)
      await saveDraftOnce()

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getByLabelText(/first name/i), 'Ada')
      await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
      await user.type(screen.getByLabelText(/email/i), ' Ada@Example.com ')
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getAllByLabelText(/first name/i)[1]!, 'Grace')
      await user.type(screen.getAllByLabelText(/last name/i)[1]!, 'Hopper')
      await user.type(screen.getAllByLabelText(/email/i)[1]!, 'grace@example.test')
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      // Separate row with any names but an empty email: normalized email is
      // empty, so the row must be omitted from the payload (row-by-row).
      await user.type(screen.getAllByLabelText(/first name/i)[2]!, 'Omit')
      await user.type(screen.getAllByLabelText(/last name/i)[2]!, 'Me')
      await user.type(screen.getAllByLabelText(/email/i)[2]!, '   ')

      await user.click(screen.getByRole('button', { name: /submit/i }))
      await screen.findByRole('status')

      const body = JSON.parse(String(submitCalls()[0]?.[1]?.body)) as Record<string, unknown>
      expect(Object.keys(body).sort()).toEqual([
        'answers',
        'coSpeakers',
        'formVersionId',
        'originDraftId',
        'title',
      ])
      expect(body.originDraftId).toBe('draft-1')
      expect(body.formVersionId).toBe(VERSION_ID)
      expect(body.title).toBe('My talk')
      expect(body.answers).toEqual({ format: 'talk', title: 'My talk' })
      expect(body.coSpeakers).toEqual([
        { name: 'Ada Lovelace', email: 'ada@example.com' },
        { name: 'Grace Hopper', email: 'grace@example.test' },
      ])
    })

    it.each([
      { code: 'cfp_closed', copy: /closed/i },
      { code: 'cfp_capped', copy: /cap/i },
      { code: 'identity_limit_reached', copy: /limit/i },
    ] as const)(
      'renders a distinct gate banner for $code with no retry and no raw server message',
      async ({ code, copy }) => {
        const { user } = await mountWizard()
        await advanceToSubmitStep(user)
        await saveDraftOnce()
        fetchHandler = (url, init) => {
          const method = init?.method ?? 'GET'
          if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
            return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
          }
          if (method === 'PUT' && url === '/api/public/draft') {
            return jsonResponse({
              id: 'draft-1',
              eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
              formVersionId: VERSION_ID,
              title: 'My talk',
              answers: { format: 'talk', title: 'My talk' },
              updatedAt: '2026-08-08T10:00:00.000Z',
            })
          }
          if (method === 'POST' && url === '/api/public/submit') {
            return jsonResponse({ error: { code, message: 'server copy' } }, 409)
          }
          return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
        }

        await user.click(screen.getByRole('button', { name: /submit/i }))
        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(copy)
        expect(alert).not.toHaveTextContent('server copy')
        expect(submitCalls()).toHaveLength(1)
        expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
      },
    )

    it('makes zero extra fetches during the submit interaction beyond the single POST', async () => {
      const { user } = await mountWizard()
      await advanceToSubmitStep(user)
      await saveDraftOnce()
      const callsAfterSave = fetchMock.mock.calls.length

      await user.click(screen.getByRole('button', { name: /submit/i }))
      await screen.findByRole('status')

      expect(submitCalls()).toHaveLength(1)
      const postSubmitCalls = fetchMock.mock.calls.slice(callsAfterSave)
      expect(
        postSubmitCalls.every(([input, init]) => {
          return requestUrl(input) === '/api/public/submit' && (init?.method ?? 'GET') === 'POST'
        }),
      ).toBe(true)
    })

    it.each([
      { status: 404, code: 'not_found', message: 'Not found' },
      { status: 400, code: 'validation_failed', message: 'Validation failed' },
    ] as const)(
      'renders a generic safe state for $status $code without an id echo and keeps the draft intact',
      async ({ status, code, message }) => {
        const { queryClient, user } = await mountWizard()
        await advanceToSubmitStep(user)
        await saveDraftOnce()
        fetchHandler = (url, init) => {
          const method = init?.method ?? 'GET'
          if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
            return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
          }
          if (method === 'PUT' && url === '/api/public/draft') {
            return jsonResponse({
              id: 'draft-1',
              eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
              formVersionId: VERSION_ID,
              title: 'My talk',
              answers: { format: 'talk', title: 'My talk' },
              updatedAt: '2026-08-08T10:00:00.000Z',
            })
          }
          if (method === 'POST' && url === '/api/public/submit') {
            return jsonResponse({ error: { code, message } }, status)
          }
          return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
        }

        await user.click(screen.getByRole('button', { name: /submit/i }))
        const alert = await screen.findByRole('alert')
        expect(alert).toBeInTheDocument()
        const rendered = document.body.textContent ?? ''
        expect(rendered).not.toContain('draft-1')
        expect(rendered).not.toContain(message)
        // Every status region is mounted and silent: a refused submit must
        // leave nothing behind that reads as an outcome.
        for (const region of screen.queryAllByRole('status')) expect(region).toHaveTextContent('')
        expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
        const editor = queryClient.getQueryData<{
          readonly draftId: string | null
        }>(['public', 'editor'])
        expect(editor?.draftId).toBe('draft-1')
      },
    )
  })
})
