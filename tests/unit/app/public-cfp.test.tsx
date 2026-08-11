import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormDefinitionDto } from '../../../src/application'
import CfpFields from '../../../src/app/features/public/CfpFields'
import CfpStepRenderer from '../../../src/app/features/public/CfpStepRenderer'
import CfpStepper from '../../../src/app/features/public/CfpStepper'
import CfpWizard from '../../../src/app/features/public/CfpWizard'

const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'

const PUBLISHED_FORM: FormDefinitionDto = {
  formId: 'f0000000-0000-4000-8000-000000000001',
  formSlug: FORM_SLUG,
  eventSlug: EVENT_SLUG,
  versionId: 'f0000000-0000-4000-8000-000000000002',
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

let fetchMock: ReturnType<typeof vi.fn>

function renderCfp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CfpWizard form={PUBLISHED_FORM} eventSlug={EVENT_SLUG} formSlug={FORM_SLUG} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('public multi-step CFP form', () => {
  it('exposes the intended public CFP module surface', () => {
    expect(CfpStepper).toBeTypeOf('function')
    expect(CfpStepRenderer).toBeTypeOf('function')
    expect(CfpFields).toBeTypeOf('function')
    expect(CfpWizard).toBeTypeOf('function')
    expect(PUBLISHED_FORM.pages.map((page) => page.id)).toEqual(['p-1', 'p-2', 'p-3', 'p-4'])
    expect(PUBLISHED_FORM.conditionRules).toHaveLength(2)
  })

  it('renders a semantic ordered stepper with every page in order', async () => {
    renderCfp()

    const stepperList = await screen.findByRole('list')
    expect(stepperList.tagName).toBe('OL')
    for (const title of ['Welcome', 'About your proposal', 'Review', 'Submit']) {
      expect(
        await screen.findByRole('listitem', { name: new RegExp(title, 'i') }),
      ).toBeInTheDocument()
    }
    expect(await screen.findByRole('listitem', { name: /welcome/i })).toHaveAttribute(
      'aria-current',
      'step',
    )
  })

  it('moves the current step with Back and Next and handles first/last edges', async () => {
    const user = userEvent.setup()
    renderCfp()

    expect(await screen.findByRole('listitem', { name: /welcome/i })).toHaveAttribute(
      'aria-current',
    )
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByRole('listitem', { name: /about your proposal/i })).toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()

    // Fill the required talk-path fields so the controller lets us advance.
    await user.selectOptions(await screen.findByLabelText(/format/i), 'talk')
    await user.type(await screen.findByLabelText(/title/i), 'My talk')
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByRole('listitem', { name: /review/i })).toHaveAttribute('aria-current')
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByRole('listitem', { name: /submit/i })).toHaveAttribute('aria-current')
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
  })

  it('blocks Next on per-step validation, focuses the first invalid field, and announces', async () => {
    const user = userEvent.setup()
    renderCfp()

    await user.click(await screen.findByRole('button', { name: /next/i }))
    expect(await screen.findByRole('listitem', { name: /about your proposal/i })).toHaveAttribute(
      'aria-current',
    )

    const format = await screen.findByLabelText(/format/i)
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByRole('listitem', { name: /about your proposal/i })).toHaveAttribute(
      'aria-current',
    )
    expect(format).toHaveAttribute('aria-invalid', 'true')
    expect(format).toHaveAttribute('aria-describedby')
    expect(format).toHaveFocus()
  })

  it('reveals workshop_details on format=workshop with focus and a polite announce', async () => {
    const user = userEvent.setup()
    renderCfp()

    await user.click(await screen.findByRole('button', { name: /next/i }))
    await user.selectOptions(await screen.findByLabelText(/format/i), 'workshop')

    const details = await screen.findByLabelText(/workshop details/i)
    expect(details).toBeInTheDocument()
    expect(await screen.findByLabelText(/summary/i)).toBeInTheDocument()
    expect(details).toHaveFocus()
    // One of the surface's live regions carries it: the save bar owns a second
    // one, mounted and silent, so the query cannot be a singular one.
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((region) => /workshop/i.test(region.textContent ?? '')),
      ).toBe(true),
    )
  })

  it('clears the hidden workshop_details answer when format changes away and back', async () => {
    const user = userEvent.setup()
    renderCfp()

    await user.click(await screen.findByRole('button', { name: /next/i }))
    const format = await screen.findByLabelText(/format/i)
    await user.selectOptions(format, 'workshop')
    const details = await screen.findByLabelText(/workshop details/i)
    await user.type(details, 'Hands-on session')

    await user.selectOptions(format, 'talk')

    expect(screen.queryByLabelText(/workshop details/i)).not.toBeInTheDocument()
    expect(await screen.findByLabelText(/summary/i)).toBeInTheDocument()
    expect(format).toHaveFocus()

    // Re-revealing shows the field with the hidden answer cleared, not retained.
    await user.selectOptions(format, 'workshop')
    expect(await screen.findByLabelText(/workshop details/i)).toHaveValue('')
  })

  it('keeps summary optional for talk and reaches Review with an empty summary', async () => {
    const user = userEvent.setup()
    renderCfp()

    await user.click(await screen.findByRole('button', { name: /next/i }))
    const format = await screen.findByLabelText(/format/i)
    const summary = await screen.findByLabelText(/summary/i)
    expect(summary).not.toHaveAttribute('aria-invalid', 'true')

    await user.selectOptions(format, 'talk')
    await user.type(await screen.findByLabelText(/title/i), 'My talk')
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByRole('listitem', { name: /review/i })).toHaveAttribute('aria-current')
  })

  it('requires summary for workshop and blocks Next with aria-invalid when empty', async () => {
    const user = userEvent.setup()
    renderCfp()

    await user.click(await screen.findByRole('button', { name: /next/i }))
    const format = await screen.findByLabelText(/format/i)
    await user.selectOptions(format, 'workshop')
    await user.type(await screen.findByLabelText(/title/i), 'My talk')
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByLabelText(/summary/i)).toHaveAttribute('aria-invalid', 'true')
    expect(await screen.findByRole('listitem', { name: /about your proposal/i })).toHaveAttribute(
      'aria-current',
    )
  })

  it('makes no additional network calls during step and reveal transitions after the initial load', async () => {
    const user = userEvent.setup()
    renderCfp()

    // The frozen definition is injected, so the initial load performs no fetch.
    await screen.findByRole('listitem', { name: /welcome/i })
    const callsAfterInitialLoad = fetchMock.mock.calls.length

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.selectOptions(await screen.findByLabelText(/format/i), 'workshop')
    await user.click(screen.getByRole('button', { name: /back/i }))

    expect(fetchMock.mock.calls.length).toBe(callsAfterInitialLoad)
  })

  it('arms the beforeunload guard while dirty without blocking in-form Back/Next', async () => {
    const user = userEvent.setup()
    renderCfp()

    await user.click(await screen.findByRole('button', { name: /next/i }))
    const title = await screen.findByLabelText(/title/i)
    await user.type(title, 'My talk')

    const dirtyEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)

    // In-form Back/Next move steps without an away-confirm dialog.
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('listitem', { name: /welcome/i })).toHaveAttribute(
      'aria-current',
    )
  })
})
