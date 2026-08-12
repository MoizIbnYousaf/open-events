import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormDefinitionDto } from '../../../src/application'
import CfpWizard from '../../../src/app/features/public/CfpWizard'
import {
  publicDraftQueryKeys,
  type PublicEditorState,
} from '../../../src/app/queries/public-drafts'

const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'

/** Seed-shaped published CFP: NO title question element (the real seeded form). */
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
    { id: 'p-2', position: 1, kind: 'info', title: 'Proposal information', content: '' },
    { id: 'p-3', position: 2, kind: 'info', title: 'Participant information', content: '' },
    { id: 'p-4', position: 3, kind: 'submit', title: 'Review and submit', content: '' },
  ],
  elements: [
    {
      id: 'e-1',
      pageId: 'p-2',
      position: 0,
      kind: 'question',
      fieldKey: 'format',
      label: 'Session format',
      required: true,
      maxLength: null,
      questionType: 'single_choice',
      options: ['workshop', 'talk'],
    },
    {
      id: 'e-2',
      pageId: 'p-2',
      position: 1,
      kind: 'question',
      fieldKey: 'workshop_details',
      label: 'Workshop details',
      required: true,
      maxLength: 2000,
      questionType: 'long_text',
      options: [],
    },
  ],
  conditionRules: [
    {
      id: 'r-1',
      elementId: 'e-2',
      effect: 'show',
      position: 0,
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'format', value: 'workshop' }],
        },
      ],
    },
  ],
}

/** Form with a title QUESTION (required: false) — the dedicated field is hidden. */
const TITLE_QUESTION_FORM: FormDefinitionDto = {
  ...PUBLISHED_FORM,
  elements: [
    ...PUBLISHED_FORM.elements,
    {
      id: 'e-3',
      pageId: 'p-2',
      position: 2,
      kind: 'question',
      fieldKey: 'title',
      label: 'Title',
      required: false,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
  ],
}

const SAVED_DRAFT = {
  id: 'draft-1',
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  formVersionId: VERSION_ID,
  title: 'My talk',
  answers: { format: 'talk' },
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
  answers: { format: 'talk' },
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

function draftUrl() {
  return `/api/public/draft?formId=${FORM_ID}`
}

function draftPutBodies() {
  return fetchMock.mock.calls
    .filter(
      ([input, init]) =>
        requestUrl(input) === '/api/public/draft' && (init?.method ?? 'GET') === 'PUT',
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

function submitPostBodies() {
  return fetchMock.mock.calls
    .filter(
      ([input, init]) =>
        requestUrl(input) === '/api/public/submit' && (init?.method ?? 'GET') === 'POST',
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

async function mountWizardWith(form: FormDefinitionDto) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <CfpWizard form={form} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />
    </QueryClientProvider>,
  )
  return { queryClient, user }
}

async function mountWizard() {
  return mountWizardWith(PUBLISHED_FORM)
}

/**
 * Be standing on Proposal information.
 *
 * How we get there depends on whether a draft is being restored, and the caller
 * always knows which: a restored draft moves the wizard to the step holding it
 * holding it, while a fresh form waits on Welcome for a Next. Deciding by reading
 * `aria-current` instead is a race — the restore lands in an effect, so a read
 * that happens a tick early presses Next INTO the transition and overshoots to
 * the following step.
 */
async function advanceToProposalInformation(
  user: ReturnType<typeof userEvent.setup>,
  options: { readonly resumed?: boolean } = {},
) {
  if (options.resumed === true) {
    await waitFor(() =>
      expect(screen.getByRole('listitem', { name: /proposal information/i })).toHaveAttribute(
        'aria-current',
      ),
    )
    return
  }
  await user.click(await screen.findByRole('button', { name: /next/i }))
  expect(await screen.findByRole('listitem', { name: /proposal information/i })).toHaveAttribute(
    'aria-current',
  )
}

async function fillProposalAndSave(user: ReturnType<typeof userEvent.setup>, title = 'My talk') {
  const format = await screen.findByLabelText(/session format/i)
  await user.selectOptions(format, 'talk')
  await user.type(await screen.findByRole('textbox', { name: 'Proposal title' }), title)
  await user.click(await screen.findByRole('button', { name: /save/i }))
  await screen.findByText('Saved', { exact: true })
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === draftUrl()) {
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
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('public CFP proposal title', () => {
  it('shows a required Proposal title input on the Proposal information step', async () => {
    const { user } = await mountWizard()

    // Page-scoped: not on the Welcome step.
    expect(screen.queryByRole('textbox', { name: 'Proposal title' })).not.toBeInTheDocument()

    await advanceToProposalInformation(user)

    const titleInput = await screen.findByRole('textbox', { name: 'Proposal title' })
    expect(titleInput).toBeRequired()
    expect(screen.getByLabelText('Proposal title')).toBe(titleInput)
  })

  it('updates editor.title as the user types', async () => {
    const { queryClient, user } = await mountWizard()
    await advanceToProposalInformation(user)

    await user.type(await screen.findByRole('textbox', { name: 'Proposal title' }), 'My talk')

    expect(queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)?.dirty).toBe(
      true,
    )
    expect(queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)?.title).toBe(
      'My talk',
    )
  })

  it('persists the title through save and rehydrates it on resume', async () => {
    const { user } = await mountWizard()
    await advanceToProposalInformation(user)
    await fillProposalAndSave(user)

    expect(draftPutBodies()).toHaveLength(1)
    expect(draftPutBodies()[0]?.title).toBe('My talk')

    // Resume: a fresh mount with the saved draft hydrates the title back.
    cleanup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === draftUrl()) {
        return jsonResponse(SAVED_DRAFT)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { user: resumedUser } = await mountWizard()
    await advanceToProposalInformation(resumedUser, { resumed: true })

    expect(await screen.findByRole('textbox', { name: 'Proposal title' })).toHaveValue('My talk')
  })

  it('enables the submit step with the title in the submit payload', async () => {
    // Mounting the submit step (CfpCoSpeakers) observes the same editor key;
    // usePublicEditor must never refetch its initializer and wipe saved state.
    const { user } = await mountWizard()
    await advanceToProposalInformation(user)
    await fillProposalAndSave(user)

    await user.click(await screen.findByRole('button', { name: /next/i }))
    await user.click(await screen.findByRole('button', { name: /next/i }))
    expect(await screen.findByRole('listitem', { name: /review and submit/i })).toHaveAttribute(
      'aria-current',
    )

    const submit = await screen.findByRole('button', { name: /submit/i })
    expect(submit).toBeEnabled()
    await user.click(submit)

    expect(submitPostBodies()).toHaveLength(1)
    expect(submitPostBodies()[0]?.title).toBe('My talk')
  })
})

describe('public CFP proposal title with a title question', () => {
  it('renders only the title question input, not the dedicated field', async () => {
    const { user } = await mountWizardWith(TITLE_QUESTION_FORM)
    await advanceToProposalInformation(user)

    expect(screen.queryByRole('textbox', { name: 'Proposal title' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: /title/i })).toHaveLength(1)
  })

  it('syncs editor.title and dirty when the title question is answered', async () => {
    const { queryClient, user } = await mountWizardWith(TITLE_QUESTION_FORM)
    await advanceToProposalInformation(user)

    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'My talk')

    const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
    expect(editor?.title).toBe('My talk')
    expect(editor?.dirty).toBe(true)
  })

  it('blocks Next with Proposal title required when the optional title question is empty', async () => {
    const { user } = await mountWizardWith(TITLE_QUESTION_FORM)
    await advanceToProposalInformation(user)

    await user.selectOptions(await screen.findByLabelText(/session format/i), 'talk')
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText('Proposal title is required')).toBeInTheDocument()
    expect(await screen.findByRole('listitem', { name: /proposal information/i })).toHaveAttribute(
      'aria-current',
    )
  })
})

describe('public CFP resumed draft hydration', () => {
  it('hydrates editor.draftId from the persisted draft on resume', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === draftUrl()) {
        return jsonResponse(SAVED_DRAFT)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { queryClient, user } = await mountWizard()
    await advanceToProposalInformation(user, { resumed: true })

    await screen.findByDisplayValue('My talk')
    expect(queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)?.draftId).toBe(
      'draft-1',
    )
  })

  it('reaches enabled Submit on the resumed journey after required state and a co-speaker', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === draftUrl()) {
        return jsonResponse(SAVED_DRAFT)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { user } = await mountWizard()

    // The resumed draft lands on Proposal information by itself now, so the walk
    // starts from there rather than from Welcome.
    await advanceToProposalInformation(user, { resumed: true })
    await screen.findByDisplayValue('My talk')
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByRole('listitem', { name: /review and submit/i })).toHaveAttribute(
      'aria-current',
    )

    await user.click(await screen.findByRole('button', { name: /add co-speaker/i }))
    const submit = await screen.findByRole('button', { name: /submit/i })
    expect(submit).toBeEnabled()
  })
})

describe('public CFP proposal step composition', () => {
  it('keeps the caret where the speaker put it when editing the middle of the title', async () => {
    const { user } = await mountWizard()
    await advanceToProposalInformation(user)

    const title = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Proposal title' })
    await user.type(title, 'ReactCaret')
    await user.type(title, 'ABC', { initialSelectionStart: 5, initialSelectionEnd: 5 })

    expect(title).toHaveValue('ReactABCCaret')
    expect(title.selectionStart).toBe(8)
  })

  it('keeps the words typed while a save is in flight, caret included', async () => {
    // A save is a round trip and a speaker keeps writing across it. The
    // acknowledgement used to be applied wholesale — server title in, editor
    // title out — so every keystroke made after the PUT left was discarded the
    // moment it landed, and the caret was thrown to the end of whatever was
    // left. Deterministic, not a race in the flaky sense: the deferred PUT
    // below reproduces it every run.
    let resolveSave: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === draftUrl()) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      if (method === 'PUT' && url === '/api/public/draft') {
        return new Promise<Response>((resolve) => {
          resolveSave = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const { queryClient, user } = await mountWizard()
    await advanceToProposalInformation(user)

    const title = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Proposal title' })
    await user.type(title, 'Alpha')
    await user.click(await screen.findByRole('button', { name: /save/i }))
    await screen.findByRole('button', { name: /saving/i })

    await user.type(title, ' and Beta')
    await user.type(title, '!', { initialSelectionStart: 5, initialSelectionEnd: 5 })
    expect(title).toHaveValue('Alpha! and Beta')

    // The server only ever saw what the request carried.
    expect(draftPutBodies()).toHaveLength(1)
    expect(draftPutBodies()[0]?.title).toBe('Alpha')
    resolveSave?.(jsonResponse({ ...SAVED_DRAFT, title: 'Alpha' }))
    await screen.findByText('Saved', { exact: true })

    expect(title).toHaveValue('Alpha! and Beta')
    expect(title.selectionStart).toBe(6)
    expect(document.activeElement).toBe(title)
    // Still unsaved work, because it is: nobody has stored those keystrokes.
    expect(queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)?.title).toBe(
      'Alpha! and Beta',
    )
    expect(queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)?.dirty).toBe(
      true,
    )
  })

  it('accepts the saved draft wholesale when nothing was typed during the save', async () => {
    const { queryClient, user } = await mountWizard()
    await advanceToProposalInformation(user)
    await fillProposalAndSave(user)

    const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
    expect(editor?.title).toBe('My talk')
    expect(editor?.draftId).toBe(SAVED_DRAFT.id)
    expect(editor?.dirty).toBe(false)
  })

  it('renders the step heading and description above the first field', async () => {
    const { user } = await mountWizard()
    await advanceToProposalInformation(user)

    const heading = await screen.findByRole('heading', { name: 'Proposal information' })
    const title = await screen.findByRole('textbox', { name: 'Proposal title' })
    expect(heading.tagName).toBe('H2')
    expect(
      heading.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0)
  })

  it('focuses the proposal title — the first field on the step — on arrival', async () => {
    const { user } = await mountWizard()
    await advanceToProposalInformation(user)

    expect(await screen.findByRole('textbox', { name: 'Proposal title' })).toHaveFocus()
  })

  it('focuses the title, not the second invalid field, when the step fails validation', async () => {
    const { user } = await mountWizard()
    await advanceToProposalInformation(user)

    await user.click(screen.getByRole('button', { name: /next/i }))

    const title = await screen.findByRole('textbox', { name: 'Proposal title' })
    expect(title).toHaveFocus()
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(await screen.findByLabelText(/session format/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('gathers Back, Save and Next into one action bar below the content card', async () => {
    const { user } = await mountWizard()
    await advanceToProposalInformation(user)

    const back = screen.getByRole('button', { name: 'Back' })
    const save = screen.getByRole('button', { name: 'Save' })
    const next = screen.getByRole('button', { name: 'Next' })
    expect(back.parentElement).toBe(save.parentElement)
    expect(next.parentElement).toBe(save.parentElement)
    // The step's controls sit under the content they act on, never above it.
    const card = screen.getByRole('heading', { name: 'Proposal information' })
    expect(card.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0)
    // The stepper is the map alone.
    expect(screen.getByRole('navigation', { name: 'Form steps' })).not.toContainElement(next)
  })
})

describe('public CFP review step', () => {
  async function reachReviewStep(user: ReturnType<typeof userEvent.setup>) {
    await advanceToProposalInformation(user)
    await user.selectOptions(await screen.findByLabelText(/session format/i), 'talk')
    await user.type(await screen.findByRole('textbox', { name: 'Proposal title' }), 'My talk')
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByRole('listitem', { name: /review and submit/i })).toHaveAttribute(
      'aria-current',
    )
  }

  it('summarises the answers the speaker is about to send', async () => {
    const { user } = await mountWizard()
    await reachReviewStep(user)

    const summaryTitle = screen.getByText('Proposal title', { selector: 'dt' })
    expect(summaryTitle).toBeInTheDocument()
    expect(summaryTitle.parentElement).toHaveTextContent('My talk')
    const format = screen.getByText('Session format', { selector: 'dt' })
    expect(format.parentElement).toHaveTextContent('talk')
    // Hidden questions were never asked, so the summary does not list them.
    expect(screen.queryByText('Workshop details', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('says in words why Submit is off before the draft has been saved', async () => {
    const { user } = await mountWizard()
    await reachReviewStep(user)

    const submit = screen.getByRole('button', { name: /submit/i })
    expect(submit).toBeDisabled()
    const reason = screen.getByText(/save your draft first/i)
    expect(submit).toHaveAttribute('aria-describedby', reason.id)
    expect(reason.id).not.toBe('')
  })
})
