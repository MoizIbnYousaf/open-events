import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormDefinitionDto } from '../../../src/application'
import { MAX_CO_SPEAKERS, normalizeEmail } from '../../../src/domain'
import CfpCoSpeakers from '../../../src/app/features/public/CfpCoSpeakers'
import CfpWizard from '../../../src/app/features/public/CfpWizard'
import { publicDraftQueryKeys } from '../../../src/app/queries/public-drafts'

interface EditorWithCoSpeakers {
  readonly formId: string
  readonly formVersionId: string
  readonly draftId: string | null
  readonly title: string
  readonly answers: Readonly<Record<string, string>>
  readonly dirty: boolean
  readonly reloadIntent: boolean
  readonly coSpeakers: readonly {
    readonly firstName: string
    readonly lastName: string
    readonly email: string
  }[]
}

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

async function mountWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <CfpWizard form={PUBLISHED_FORM} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />
    </QueryClientProvider>,
  )
  return { queryClient, user }
}

async function advanceToSubmitStep(user: ReturnType<typeof userEvent.setup>) {
  // Reach the submit step deterministically: required format answer + 3x Next.
  await user.click(await screen.findByRole('button', { name: /next/i }))
  await user.selectOptions(await screen.findByLabelText(/format/i), 'talk')
  await user.type(await screen.findByLabelText(/title/i), 'My talk')
  await user.click(screen.getByRole('button', { name: /next/i }))
  await user.click(screen.getByRole('button', { name: /next/i }))
  expect(await screen.findByRole('listitem', { name: /submit/i })).toHaveAttribute('aria-current')
}

async function mountToSubmitStep() {
  const { queryClient, user } = await mountWizard()
  await advanceToSubmitStep(user)
  return { queryClient, user }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
    }
    if (method === 'PUT' && url === '/api/public/draft') {
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
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

describe('public CFP co-speakers', () => {
  describe('module surface', () => {
    it('exposes the intended co-speaker module surface', () => {
      expect(CfpCoSpeakers).toBeTypeOf('function')
      expect(MAX_CO_SPEAKERS).toBe(10)
      expect(normalizeEmail(' Speaker.A@Example.com ')).toBe('speaker.a@example.com')
    })
  })

  describe('wizard integration', () => {
    it('shows no co-speaker controls before the submit step and shows them on it', async () => {
      const { user } = await mountWizard()

      // After the first Next (info step), the co-speaker controls are absent.
      await user.click(await screen.findByRole('button', { name: /next/i }))
      expect(screen.queryByRole('button', { name: /add co-speaker/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()

      // On the submit step they are present.
      await user.selectOptions(await screen.findByLabelText(/format/i), 'talk')
      await user.type(await screen.findByLabelText(/title/i), 'My talk')
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      expect(await screen.findByRole('listitem', { name: /submit/i })).toHaveAttribute(
        'aria-current',
      )
      expect(screen.getByRole('button', { name: /add co-speaker/i })).toBeInTheDocument()
    })

    it('inserts one empty editable row with three labeled inputs and a named remove control', async () => {
      const { user } = await mountToSubmitStep()
      const callsBefore = fetchMock.mock.calls.length

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))

      expect(screen.getAllByLabelText(/first name/i)).toHaveLength(1)
      expect(screen.getAllByLabelText(/last name/i)).toHaveLength(1)
      expect(screen.getAllByLabelText(/email/i)).toHaveLength(1)
      expect(screen.getByRole('button', { name: /remove co-speaker/i })).toBeInTheDocument()
      expect(fetchMock.mock.calls.length).toBe(callsBefore)
    })

    it('keeps edits across subsequent row interactions', async () => {
      const { user } = await mountToSubmitStep()

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getByLabelText(/first name/i), 'Ada')
      await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
      await user.type(screen.getByLabelText(/email/i), 'ada@example.test')

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      expect(screen.getAllByLabelText(/email/i)[0]).toHaveValue('ada@example.test')
      expect(screen.getAllByLabelText(/first name/i)[0]).toHaveValue('Ada')
      expect(screen.getAllByLabelText(/last name/i)[0]).toHaveValue('Lovelace')
    })

    it('removes exactly the targeted row and leaves the other rows intact', async () => {
      const { user } = await mountToSubmitStep()

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getByLabelText(/first name/i), 'Ada')
      await user.type(screen.getByLabelText(/email/i), 'ada@example.test')
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getAllByLabelText(/first name/i)[1]!, 'Grace')
      await user.type(screen.getAllByLabelText(/email/i)[1]!, 'grace@example.test')

      await user.click(screen.getByRole('button', { name: /remove co-speaker 1/i }))

      expect(screen.getAllByLabelText(/email/i)).toHaveLength(1)
      expect(screen.getByLabelText(/first name/i)).toHaveValue('Grace')
      expect(screen.getByLabelText(/email/i)).toHaveValue('grace@example.test')
    })

    it('caps rows at MAX_CO_SPEAKERS with a visible counter and disables add at the cap', async () => {
      const { user } = await mountToSubmitStep()

      for (let index = 1; index <= MAX_CO_SPEAKERS; index += 1) {
        await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
        expect(screen.getAllByLabelText(/email/i)).toHaveLength(index)
      }
      expect(
        screen.getByText(new RegExp(`${MAX_CO_SPEAKERS} of ${MAX_CO_SPEAKERS}`)),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /add co-speaker/i })).not.toBeInTheDocument()
    })

    it('dedupes by normalized email with a role=alert and keeps the normalized form', async () => {
      const { user } = await mountToSubmitStep()

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getByLabelText(/email/i), ' Speaker.A@Example.com ')
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getAllByLabelText(/email/i)[1]!, 'speaker.a@example.com')

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))

      expect(screen.getAllByLabelText(/email/i)).toHaveLength(2)
      expect(screen.getAllByLabelText(/email/i)[0]).toHaveValue('speaker.a@example.com')
      expect(await screen.findByRole('alert')).toHaveTextContent(/already|duplicate|exists/i)
    })

    it('arms the beforeunload guard after filling the proposal and adding a co-speaker', async () => {
      const { user } = await mountToSubmitStep()

      // Reaching the submit step fills required fields (format + title): those
      // are real edits, so the guard is armed and never wiped by a refetch.
      const filledEvent = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(filledEvent)
      expect(filledEvent.defaultPrevented).toBe(true)
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      const dirtyEvent = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(dirtyEvent)
      expect(dirtyEvent.defaultPrevented).toBe(true)
    })

    it('preserves co-speaker state across unrelated draft hydration and never sends it to the server', async () => {
      const { queryClient, user } = await mountToSubmitStep()

      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.type(screen.getByLabelText(/first name/i), 'Ada')
      await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
      await user.type(screen.getByLabelText(/email/i), 'ada@example.test')
      const callsBefore = fetchMock.mock.calls.length

      queryClient.setQueryData<EditorWithCoSpeakers>(publicDraftQueryKeys.editor, (current) => {
        const editor = current ?? {
          formId: FORM_ID,
          formVersionId: VERSION_ID,
          draftId: null,
          title: '',
          answers: {},
          dirty: false,
          reloadIntent: false,
          coSpeakers: [],
        }
        return {
          ...editor,
          coSpeakers: [{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' }],
          title: 'Hydrated title',
          answers: { format: 'talk', title: 'Hydrated title' },
        }
      })

      expect(screen.getByLabelText(/first name/i)).toHaveValue('Ada')
      expect(screen.getByLabelText(/last name/i)).toHaveValue('Lovelace')
      expect(screen.getByLabelText(/email/i)).toHaveValue('ada@example.test')
      expect(fetchMock.mock.calls.length).toBe(callsBefore)
      const putBodies = fetchMock.mock.calls.filter(([input, init]) => {
        return requestUrl(input) === '/api/public/draft' && (init?.method ?? 'GET') === 'PUT'
      })
      expect(putBodies).toHaveLength(0)
    })

    it('makes zero additional fetch calls during add/remove/dedupe/cap interactions', async () => {
      const { user } = await mountToSubmitStep()
      const callsAfterLoad = fetchMock.mock.calls.length

      for (let index = 0; index < 3; index += 1) {
        await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      }
      await user.type(screen.getAllByLabelText(/email/i)[0]!, 'ada@example.test')
      await user.type(screen.getAllByLabelText(/email/i)[1]!, 'ADA@example.test')
      await user.click(screen.getByRole('button', { name: /add co-speaker/i }))
      await user.click(screen.getByRole('button', { name: /remove co-speaker 1/i }))

      expect(fetchMock.mock.calls.length).toBe(callsAfterLoad)
    })
  })
})
