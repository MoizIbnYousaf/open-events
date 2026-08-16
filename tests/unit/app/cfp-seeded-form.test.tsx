import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormDefinitionDto } from '../../../src/application'
import CfpWizard from '../../../src/app/features/public/CfpWizard'

/**
 * The public call for papers, as a submitter meets it.
 *
 * The shape of the seeded form is asserted server-side in
 * tests/integration/cfp-content.test.ts. What matters here is what the wizard
 * DOES with a form of that shape: renders each question as the right control,
 * states the deadline before anyone spends an evening writing, honours the
 * conditional rules in both directions, and refuses to advance past an
 * unanswered required question with a visible error.
 *
 * The fixture mirrors the seed but is deliberately its own: these are assertions
 * about the runtime reading a DEFINITION, not about one particular event's
 * questions, and the same expectations must hold for any organizer's form.
 */
const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
const CONDITIONAL_ELEMENT = 'e-workshop-details'

const SEEDED_SHAPE: FormDefinitionDto = {
  formId: FORM_ID,
  formSlug: FORM_SLUG,
  eventSlug: EVENT_SLUG,
  versionId: VERSION_ID,
  version: 1,
  status: 'published',
  contentHash: 'a'.repeat(64),
  publishedAt: '2026-01-01T09:00:00.000Z',
  opensAt: '2026-01-01T00:00:00.000Z',
  closesAt: '2026-12-31T23:59:59.000Z',
  submissionState: 'open',
  pages: [
    { id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: 'Welcome.' },
    { id: 'p-2', position: 1, kind: 'info', title: 'Proposal information', content: '' },
    { id: 'p-3', position: 2, kind: 'info', title: 'Participant information', content: '' },
    { id: 'p-4', position: 3, kind: 'submit', title: 'Review and submit', content: '' },
  ],
  elements: [
    {
      id: 'e-format',
      pageId: 'p-2',
      position: 0,
      kind: 'question',
      fieldKey: 'format',
      label: 'Session format',
      required: true,
      maxLength: null,
      questionType: 'single_choice',
      options: ['Talk', 'Workshop', 'Lightning talk'],
    },
    {
      id: 'e-track',
      pageId: 'p-2',
      position: 1,
      kind: 'question',
      fieldKey: 'track',
      label: 'Track',
      required: true,
      maxLength: null,
      questionType: 'single_choice',
      options: ['Platform & Infra', 'AI Engineering', 'Developer Experience'],
    },
    {
      id: 'e-abstract',
      pageId: 'p-2',
      position: 2,
      kind: 'question',
      fieldKey: 'abstract',
      label: 'Abstract',
      required: true,
      maxLength: 2000,
      questionType: 'long_text',
      options: [],
    },
    {
      id: 'e-audience',
      pageId: 'p-2',
      position: 3,
      kind: 'question',
      fieldKey: 'audience_level',
      label: 'Audience level',
      required: true,
      maxLength: null,
      questionType: 'single_choice',
      options: ['Beginner', 'Intermediate', 'Advanced'],
    },
    {
      id: 'e-takeaway',
      pageId: 'p-2',
      position: 4,
      kind: 'question',
      fieldKey: 'key_takeaway',
      label: 'Key takeaway',
      required: true,
      maxLength: 200,
      questionType: 'short_text',
      options: [],
    },
    {
      id: CONDITIONAL_ELEMENT,
      pageId: 'p-2',
      position: 5,
      kind: 'question',
      fieldKey: 'workshop_details',
      label: 'Workshop details',
      required: false,
      maxLength: 2000,
      questionType: 'long_text',
      options: [],
    },
    {
      id: 'e-bio',
      pageId: 'p-3',
      position: 0,
      kind: 'question',
      fieldKey: 'speaker_bio',
      label: 'Speaker bio',
      required: true,
      maxLength: 1000,
      questionType: 'long_text',
      options: [],
    },
    {
      id: 'e-job',
      pageId: 'p-3',
      position: 1,
      kind: 'question',
      fieldKey: 'job_title',
      label: 'Job title',
      required: false,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
  ],
  conditionRules: [
    {
      id: 'r-show',
      elementId: CONDITIONAL_ELEMENT,
      effect: 'show',
      position: 0,
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'format', value: 'Workshop' }],
        },
      ],
    },
    {
      id: 'r-require',
      elementId: CONDITIONAL_ELEMENT,
      effect: 'require',
      position: 1,
      groups: [
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'format', value: 'Workshop' }],
        },
      ],
    },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('/api/public/draft')) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: { code: 'internal', message: 'unexpected' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <CfpWizard form={SEEDED_SHAPE} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />
    </QueryClientProvider>,
  )
  return { user }
}

const toProposalStep = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: /next/i }))
  await screen.findByLabelText(/session format/i)
}

describe('the public call for papers renders every question it is given', () => {
  it('renders each question as the control its type calls for', async () => {
    const { user } = mount()
    await toProposalStep(user)

    // A dropdown is a select with the configured options, in order.
    const format = await screen.findByLabelText(/session format/i)
    expect(format.tagName).toBe('SELECT')
    expect(
      within(format)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Select…', 'Talk', 'Workshop', 'Lightning talk'])

    const track = await screen.findByLabelText(/^track/i)
    expect(
      within(track)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Select…', 'Platform & Infra', 'AI Engineering', 'Developer Experience'])

    const audience = await screen.findByLabelText(/audience level/i)
    expect(
      within(audience)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Select…', 'Beginner', 'Intermediate', 'Advanced'])

    // Long text is a textarea; short text is a single-line input.
    expect((await screen.findByLabelText(/abstract/i)).tagName).toBe('TEXTAREA')
    expect((await screen.findByLabelText(/key takeaway/i)).tagName).toBe('INPUT')
  })

  it('asks the participant about themselves rather than showing an empty step', async () => {
    const { user } = mount()
    await toProposalStep(user)
    // The proposal step has to be answered before Next moves: that is the
    // required-field enforcement asserted further down, not an obstacle here.
    await user.selectOptions(screen.getByLabelText(/session format/i), 'Talk')
    await user.selectOptions(screen.getByLabelText(/^track/i), 'AI Engineering')
    await user.type(screen.getByLabelText(/abstract/i), 'An abstract.')
    await user.selectOptions(screen.getByLabelText(/audience level/i), 'Advanced')
    await user.type(screen.getByLabelText(/key takeaway/i), 'A takeaway.')
    await user.type(screen.getByLabelText(/proposal title/i), 'A talk')
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByLabelText(/speaker bio/i)).toBeInTheDocument()
    expect(await screen.findByLabelText(/job title/i)).toBeInTheDocument()
    // The step used to render a heading over nothing.
    expect(screen.queryByText(/no questions/i)).not.toBeInTheDocument()
  })
})

describe('the public call for papers states its deadline', () => {
  it('shows the close date to a logged-out visitor, with the machine value beside it', async () => {
    mount()
    // Before any step is taken and without any session: a visitor deciding
    // whether to start needs the date first, not after they have written.
    const deadline = await screen.findByText(/submissions close/i)
    expect(deadline).toBeInTheDocument()
    const time = deadline.closest('*')?.querySelector('time')
    expect(time).not.toBeNull()
    expect(time).toHaveAttribute('dateTime', '2026-12-31T23:59:59.000Z')
    // A date a person can read, not the wire format.
    expect(deadline.textContent).toMatch(/December/)
    expect(deadline.textContent).not.toContain('2026-12-31T23:59:59.000Z')
  })
})

describe('conditional questions follow the answer in both directions', () => {
  it('reveals the dependent question for Workshop and hides it again for Talk', async () => {
    const { user } = mount()
    await toProposalStep(user)

    // Absent for the default (nothing chosen).
    expect(screen.queryByLabelText(/workshop details/i)).not.toBeInTheDocument()

    await user.selectOptions(await screen.findByLabelText(/session format/i), 'Workshop')
    expect(await screen.findByLabelText(/workshop details/i)).toBeInTheDocument()

    // And back. A field that appears but never leaves is not conditional.
    await user.selectOptions(await screen.findByLabelText(/session format/i), 'Talk')
    await waitFor(() =>
      expect(screen.queryByLabelText(/workshop details/i)).not.toBeInTheDocument(),
    )
  })

  it('makes the revealed question required only while it is shown', async () => {
    const { user } = mount()
    await toProposalStep(user)

    await user.selectOptions(await screen.findByLabelText(/session format/i), 'Workshop')
    const details = await screen.findByLabelText(/workshop details/i)
    // Requiredness comes from the rule, not from the element's own flag.
    expect(details).toBeRequired()

    await user.selectOptions(await screen.findByLabelText(/session format/i), 'Talk')
    await waitFor(() =>
      expect(screen.queryByLabelText(/workshop details/i)).not.toBeInTheDocument(),
    )
    // A Talk must be able to advance past a question it was never shown, so
    // filling every visible required field is enough.
    await user.selectOptions(screen.getByLabelText(/^track/i), 'AI Engineering')
    await user.type(screen.getByLabelText(/abstract/i), 'An abstract.')
    await user.selectOptions(screen.getByLabelText(/audience level/i), 'Advanced')
    await user.type(screen.getByLabelText(/key takeaway/i), 'A takeaway.')
    await user.type(screen.getByLabelText(/proposal title/i), 'A talk')
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByLabelText(/speaker bio/i)).toBeInTheDocument()
  })
})

describe('required questions block progress with a visible error', () => {
  it('refuses to advance with an empty required question and says which one', async () => {
    const { user } = mount()
    await toProposalStep(user)

    await user.click(screen.getByRole('button', { name: /next/i }))

    // Still on the proposal step, with a visible error and the field marked.
    expect(await screen.findByLabelText(/session format/i)).toBeInTheDocument()
    const errors = await screen.findAllByText(/required/i)
    expect(errors.length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/session format/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/abstract/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('blocks a Workshop that leaves the conditionally required question empty', async () => {
    const { user } = mount()
    await toProposalStep(user)

    await user.selectOptions(screen.getByLabelText(/session format/i), 'Workshop')
    await user.selectOptions(screen.getByLabelText(/^track/i), 'Platform & Infra')
    await user.type(screen.getByLabelText(/abstract/i), 'An abstract.')
    await user.selectOptions(screen.getByLabelText(/audience level/i), 'Intermediate')
    await user.type(screen.getByLabelText(/key takeaway/i), 'A takeaway.')
    await user.type(screen.getByLabelText(/proposal title/i), 'A workshop')
    // Everything answered EXCEPT the question the format made mandatory.
    await user.click(screen.getByRole('button', { name: /next/i }))

    const details = await screen.findByLabelText(/workshop details/i)
    expect(details).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByLabelText(/speaker bio/i)).not.toBeInTheDocument()
  })
})
