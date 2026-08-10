import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../../../src/app/query-client'
import CommunicationsPanel from '../../../src/app/features/admin/CommunicationsPanel'

const SUBMISSION_ID = 'f0000000-0000-4000-8000-000000000900'
const PREVIEW_PATH = `/api/admin/submissions/${SUBMISSION_ID}/acceptance-preview`
const MESSAGES_PATH = `/api/admin/submissions/${SUBMISSION_ID}/messages`
const SEND_PATH = `/api/admin/submissions/${SUBMISSION_ID}/acceptance-send`

const PREVIEW = {
  submissionId: SUBMISSION_ID,
  toEmail: 'speaker-a@example.test',
  subject: 'Your proposal "Workshop proposal" is accepted for DemoConf 2026',
  body: 'Hi Speaker A,\n\n"Workshop proposal" has been accepted for DemoConf 2026.',
  alreadySent: false,
}

const SENT_MESSAGE = {
  id: 'f0000000-0000-4000-8000-000000000901',
  submissionId: SUBMISSION_ID,
  toEmail: 'speaker-a@example.test',
  subject: PREVIEW.subject,
  body: PREVIEW.body,
  createdAt: '2026-05-20T09:00:00.000Z',
}

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>
let history: (typeof SENT_MESSAGE)[]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function callsTo(url: string, method: string): number {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      requestUrl(input) === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ).length
}

function mountPanel() {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <CommunicationsPanel submissionId={SUBMISSION_ID} />
    </QueryClientProvider>,
  )
}

function defaultHandler(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET'
  if (method === 'GET' && url === PREVIEW_PATH) {
    return jsonResponse({ ...PREVIEW, alreadySent: history.length > 0 })
  }
  if (method === 'GET' && url === MESSAGES_PATH) {
    return jsonResponse(history)
  }
  if (method === 'POST' && url === SEND_PATH) {
    if (history.length === 0) history = [SENT_MESSAGE]
    return jsonResponse(history[0])
  }
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

beforeEach(() => {
  history = []
  fetchHandler = defaultHandler
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    fetchHandler(requestUrl(input), init),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('communications panel', () => {
  it('announces the loading state with aria-busy and role=status', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve()
      }
    })
    fetchHandler = async (url, init) => {
      await gate
      return defaultHandler(url, init)
    }
    mountPanel()

    const status = await screen.findByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    release()
    await screen.findByText(PREVIEW.subject)
  })

  it('renders the rendered acceptance preview and the empty history state', async () => {
    mountPanel()

    expect(await screen.findByText(PREVIEW.subject)).toBeInTheDocument()
    expect(screen.getByText(/no acceptance message sent yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send acceptance' })).toBeEnabled()
  })

  it('sends the acceptance once and disables the button from the refreshed history', async () => {
    const user = userEvent.setup()
    mountPanel()

    await user.click(await screen.findByRole('button', { name: 'Send acceptance' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send acceptance' })).toBeDisabled(),
    )
    expect(callsTo(SEND_PATH, 'POST')).toBe(1)
    expect(screen.getByText(SENT_MESSAGE.createdAt)).toBeInTheDocument()
    expect(screen.queryByText(/no acceptance message sent yet/i)).not.toBeInTheDocument()
  })

  it('starts disabled when the submission already has a send history', async () => {
    history = [SENT_MESSAGE]
    mountPanel()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send acceptance' })).toBeDisabled(),
    )
    expect(callsTo(SEND_PATH, 'POST')).toBe(0)
  })

  it('shows an alert with a working retry when the preview fails to load', async () => {
    const user = userEvent.setup()
    let failed = false
    fetchHandler = (url, init) => {
      if (!failed && url === PREVIEW_PATH) {
        failed = true
        return jsonResponse({ error: { code: 'internal', message: 'Internal error' } }, 500)
      }
      return defaultHandler(url, init)
    }
    mountPanel()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(PREVIEW.subject)).toBeInTheDocument()
  })

  it('surfaces a send failure as an alert and keeps the button usable', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      if ((init?.method ?? 'GET') === 'POST' && url === SEND_PATH) {
        return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
      }
      return defaultHandler(url, init)
    }
    mountPanel()

    await user.click(await screen.findByRole('button', { name: 'Send acceptance' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send acceptance' })).toBeEnabled()
  })
})
