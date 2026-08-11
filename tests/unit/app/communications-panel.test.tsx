import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../../../src/app/query-client'
import CommunicationsPanel from '../../../src/app/features/admin/CommunicationsPanel'
import { clearAnnouncements } from '../../../src/app/lib/announcer'
import { LiveAnnouncer } from '../../../src/components/ui/live-announcer'
import { Toaster } from '../../../src/components/ui/sonner'

// Organizer acceptance panel: the acceptance itself (POST .../accept) and the
// acceptance message are two halves of one flow, so the panel owns both. The
// message can only be sent once the acceptance record exists — the server
// refuses otherwise — so the send stays disabled until `accepted` is true.

const SUBMISSION_ID = 'f0000000-0000-4000-8000-000000000900'
const PREVIEW_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/acceptance-preview`
const MESSAGES_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/messages`
const SEND_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/acceptance-send`
const ACCEPT_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/accept`

const PREVIEW = {
  submissionId: SUBMISSION_ID,
  toEmail: 'speaker-a@example.test',
  subject: 'Your proposal "Workshop proposal" is accepted for DemoConf 2026',
  body: 'Hi Speaker A,\n\n"Workshop proposal" has been accepted for DemoConf 2026.',
  accepted: true,
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
let accepted: boolean

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
      <CommunicationsPanel slug="demo-conf-2026" submissionId={SUBMISSION_ID} />
    </QueryClientProvider>,
  )
}

function defaultHandler(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET'
  if (method === 'GET' && url === PREVIEW_PATH) {
    return jsonResponse({ ...PREVIEW, accepted, alreadySent: history.length > 0 })
  }
  if (method === 'GET' && url === MESSAGES_PATH) {
    return jsonResponse(history)
  }
  if (method === 'POST' && url === ACCEPT_PATH) {
    const alreadyAccepted = accepted
    accepted = true
    return jsonResponse({
      submissionId: SUBMISSION_ID,
      eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
      acceptedAt: '2026-05-20T08:00:00.000Z',
      alreadyAccepted,
      tasks: [],
    })
  }
  if (method === 'POST' && url === SEND_PATH) {
    if (!accepted) {
      return jsonResponse({ error: { code: 'conflict', message: 'Conflict' } }, 409)
    }
    if (history.length === 0) history = [SENT_MESSAGE]
    return jsonResponse(history[0])
  }
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

beforeEach(() => {
  history = []
  accepted = true
  fetchHandler = defaultHandler
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    fetchHandler(requestUrl(input), init),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  clearAnnouncements()
  vi.unstubAllGlobals()
  cleanup()
})

describe('communications panel', () => {
  it('marks the section busy while announcing the loading state', async () => {
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
    expect(status).toHaveTextContent(/loading acceptance communications/i)
    // aria-busy belongs on the region being populated, never on the live
    // region: on the region it suppresses the announcement it was added for.
    expect(status).not.toHaveAttribute('aria-busy')
    expect(status.closest('[aria-busy="true"]')).not.toBeNull()
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

  it('says the acceptance was sent exactly once, through the toaster region', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LiveAnnouncer />
        <CommunicationsPanel slug="demo-conf-2026" submissionId={SUBMISSION_ID} />
        <Toaster />
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Send acceptance' }))
    await waitFor(() => expect(screen.getByText(SENT_MESSAGE.createdAt)).toBeInTheDocument())

    // The outcome is spoken by the one always-mounted toaster region. The
    // label the panel keeps afterwards is the durable record, not a second
    // live region repeating the same sentence (DEC-014).
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /notifications/i })).toHaveTextContent(
        'Acceptance sent',
      ),
    )
    const panel = container.querySelector('section') as HTMLElement
    const sent = within(panel).getByText('Acceptance sent')
    expect(sent).not.toHaveAttribute('role', 'status')
    expect(sent).not.toHaveAttribute('aria-live')
    expect(
      screen.queryAllByRole('status').filter((region) => region.textContent === 'Acceptance sent'),
    ).toHaveLength(0)
  })

  it('keeps the in-flight send status in a region that was already mounted', async () => {
    const user = userEvent.setup()
    let releaseSend: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      if ((init?.method ?? 'GET') === 'POST' && url === SEND_PATH) {
        return new Promise<Response>((resolve) => {
          releaseSend = resolve
        })
      }
      return defaultHandler(url, init)
    }
    mountPanel()

    const send = await screen.findByRole('button', { name: 'Send acceptance' })
    const before = screen.getAllByRole('status')

    await user.click(send)

    // A live region has to be in the accessibility tree before its text
    // arrives, so the in-flight message must land in a node that was already
    // there rather than in one created with it.
    const during = screen.getAllByRole('status')
    expect(during).toHaveLength(before.length)
    const region = during.find((node) => /sending the acceptance/i.test(node.textContent ?? ''))
    expect(region).toBeDefined()
    expect(before).toContain(region)

    releaseSend?.(jsonResponse(SENT_MESSAGE))
    await waitFor(() => expect(region).toHaveTextContent(''))
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

  it('accepts the proposal from the panel and only then enables the send', async () => {
    const user = userEvent.setup()
    accepted = false
    mountPanel()

    await screen.findByText(PREVIEW.subject)
    expect(screen.getByRole('button', { name: 'Send acceptance' })).toBeDisabled()
    expect(screen.getByText(/not accepted yet/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Accept proposal' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send acceptance' })).toBeEnabled(),
    )
    expect(callsTo(ACCEPT_PATH, 'POST')).toBe(1)
    expect(callsTo(SEND_PATH, 'POST')).toBe(0)
    expect(screen.queryByRole('button', { name: 'Accept proposal' })).not.toBeInTheDocument()
  })

  it('never offers a second accept for an already accepted submission', async () => {
    mountPanel()

    await screen.findByText(PREVIEW.subject)
    expect(screen.queryByRole('button', { name: 'Accept proposal' })).not.toBeInTheDocument()
    expect(screen.getByText('Acceptance recorded')).toBeInTheDocument()
  })

  it('surfaces an accept failure as an alert without claiming acceptance', async () => {
    const user = userEvent.setup()
    accepted = false
    fetchHandler = (url, init) => {
      if ((init?.method ?? 'GET') === 'POST' && url === ACCEPT_PATH) {
        return jsonResponse({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
      }
      return defaultHandler(url, init)
    }
    mountPanel()

    await screen.findByText(PREVIEW.subject)
    await user.click(screen.getByRole('button', { name: 'Accept proposal' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send acceptance' })).toBeDisabled()
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
