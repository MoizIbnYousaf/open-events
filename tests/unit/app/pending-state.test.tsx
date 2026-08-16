import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CfpSubmit from '../../../src/app/features/public/CfpSubmit'
import PublishConfirmDialog from '../../../src/app/features/builder/PublishConfirmDialog'
import EvaluationsPage from '../../../src/app/features/public/EvaluationsPage'
import { publicDraftQueryKeys } from '../../../src/app/queries/public-drafts'

const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
const EVALUATIONS_URL = '/api/public/evaluations'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

/** Holds the request open so the in-flight state can be observed. */
function neverSettles(): Promise<Response> {
  return new Promise<Response>(() => undefined)
}

let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

beforeEach(() => {
  fetchHandler = () => jsonResponse({ error: { code: 'internal' } }, 500)
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(fetchHandler(requestUrl(input), init)),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('CFP submit trigger', () => {
  it('marks the control it was pressed on as busy and says so out loud', async () => {
    fetchHandler = () => neverSettles()
    const queryClient = testQueryClient()
    queryClient.setQueryData(publicDraftQueryKeys.editor, {
      formId: FORM_ID,
      formVersionId: VERSION_ID,
      draftId: 'draft-1',
      title: 'My talk',
      answers: {},
      dirty: false,
      reloadIntent: false,
      coSpeakers: [],
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <CfpSubmit formVersionId={VERSION_ID} onDenied={() => undefined} />
      </QueryClientProvider>,
    )

    const submit = screen.getByRole('button', { name: 'Submit' })
    expect(submit).not.toHaveAttribute('aria-busy')
    // The region exists before the message does: a live region created in the
    // same commit as its text is not in the accessibility tree when the text
    // arrives, so it announces nothing.
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')

    await user.click(submit)

    const busy = await screen.findByRole('button', { name: /submitting/i })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    // Inert through aria-disabled, never the native attribute: pending is not
    // disabled. A control that goes natively disabled while it holds focus is
    // blurred by the browser, and the speaker who pressed Submit is left on
    // <body> with aria-busy sitting on an element they are no longer standing
    // on. Focus stays where it was.
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveFocus()
    // aria-busy alone is not reliably announced, so the in-flight state must
    // also exist as a status message — in the same node that was already
    // mounted.
    expect(region.isConnected).toBe(true)
    expect(region).toHaveTextContent(/submitting/i)
    expect(screen.getByRole('status')).toBe(region)
  })

  it('still refuses to submit without a saved draft, without claiming to be busy', () => {
    const queryClient = testQueryClient()
    queryClient.setQueryData(publicDraftQueryKeys.editor, {
      formId: FORM_ID,
      formVersionId: VERSION_ID,
      draftId: null,
      title: '',
      answers: {},
      dirty: false,
      reloadIntent: false,
      coSpeakers: [],
    })
    render(
      <QueryClientProvider client={queryClient}>
        <CfpSubmit formVersionId={VERSION_ID} onDenied={() => undefined} />
      </QueryClientProvider>,
    )

    const submit = screen.getByRole('button', { name: 'Submit' })
    expect(submit).toBeDisabled()
    expect(submit).not.toHaveAttribute('aria-busy')
    // Mounted and silent, not absent: the region has to be waiting in the
    // accessibility tree, and it must not claim anything is happening.
    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})

describe('publish confirmation', () => {
  it('shows the in-flight publish on the confirm control and announces it', () => {
    const { rerender } = render(
      <PublishConfirmDialog
        open
        version={3}
        pending={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )

    // The region is mounted with the dialog, before the publish starts: a
    // region created together with its text announces nothing.
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')

    rerender(
      <PublishConfirmDialog
        open
        version={3}
        pending
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )

    const confirm = screen.getByRole('button', { name: /confirm publish/i })
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(region.isConnected).toBe(true)
    expect(region).toHaveTextContent(/publishing/i)
  })

  it('carries no busy state and says nothing while it waits for a decision', () => {
    render(
      <PublishConfirmDialog
        open
        version={3}
        pending={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: /confirm publish/i })).not.toHaveAttribute(
      'aria-busy',
    )
    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})

describe('evaluation submit', () => {
  it('announces the in-flight submit next to the control, replacing the previous outcome', async () => {
    let resolveSubmit: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      if (url === EVALUATIONS_URL && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse([
          {
            submissionId: 'submission-1',
            sessionTitle: 'My talk',
            roundId: 'round-1',
            roundNumber: 1,
            roundName: 'Initial review',
            roundStatus: 'open',
            rating: 4,
            comments: 'Good',
            updatedAt: '2026-05-01T08:00:00.000Z',
            previousRounds: [],
          },
        ])
      }
      if (url === EVALUATIONS_URL) {
        return new Promise<Response>((resolve) => {
          resolveSubmit = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal' } }, 500)
    }
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={testQueryClient()}>
        <EvaluationsPage />
      </QueryClientProvider>,
    )

    await screen.findByRole('button', { name: 'Submit' })
    // Captured before the submit: the same node has to carry every outcome,
    // or the first one arrives in a region that is not yet in the tree.
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    const busy = await screen.findByRole('button', { name: /submitting/i })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(region).toHaveTextContent(/submitting/i))

    resolveSubmit?.(
      jsonResponse({
        submissionId: 'submission-1',
        sessionTitle: 'My talk',
        roundId: 'round-1',
        roundNumber: 1,
        roundName: 'Initial review',
        roundStatus: 'open',
        rating: 4,
        comments: null,
        updatedAt: '2026-05-02T08:00:00.000Z',
        previousRounds: [],
      }),
    )
    await waitFor(() => expect(region).toHaveTextContent(/submitted/i))
    expect(screen.getByRole('status')).toBe(region)
  })
})
