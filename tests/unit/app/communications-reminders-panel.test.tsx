import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CommunicationsPanel from '../../../src/app/features/admin/CommunicationsPanel'

// O2 panel contract (REQ-010): the organizer sees the resolved audience
// before sending, gets separate honest acceptance and reminder actions with
// their own pending/disabled states, cannot double-submit, sees generic
// errors only, and reads a per-recipient history typed by kind.

const SUBMISSION_ID = 'submission-1'
const ACCEPTANCE_PREVIEW_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/acceptance-preview`
const REMINDER_PREVIEW_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/reminder-preview`
const ACCEPTANCE_SEND_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/acceptance-send`
const REMINDER_SEND_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/reminder-send`
const MESSAGES_PATH = `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/messages`

const AUDIENCE = [
  { email: 'speaker-a@example.test', alreadySent: false },
  { email: 'speaker-b@example.test', alreadySent: false },
]

const ACCEPTANCE_PREVIEW = {
  submissionId: SUBMISSION_ID,
  kind: 'acceptance',
  toEmail: 'speaker-a@example.test',
  subject: 'Accepted: My talk',
  body: 'Body',
  accepted: true,
  alreadySent: false,
  audience: AUDIENCE,
}

const REMINDER_PREVIEW = {
  ...ACCEPTANCE_PREVIEW,
  kind: 'reminder',
  subject: 'Reminder: My talk',
}

function sentRow(id: string, kind: string, toEmail: string) {
  return {
    id,
    submissionId: SUBMISSION_ID,
    kind,
    toEmail,
    subject: kind === 'reminder' ? 'Reminder: My talk' : 'Accepted: My talk',
    body: 'Body',
    createdAt: '2026-08-10T09:00:00.000Z',
  }
}

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>
let history: ReadonlyArray<ReturnType<typeof sentRow>>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function defaultHandler(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET'
  if (method === 'GET' && url === ACCEPTANCE_PREVIEW_PATH) return jsonResponse(ACCEPTANCE_PREVIEW)
  if (method === 'GET' && url === REMINDER_PREVIEW_PATH) return jsonResponse(REMINDER_PREVIEW)
  if (method === 'GET' && url === MESSAGES_PATH) return jsonResponse(history)
  if (method === 'POST' && url === ACCEPTANCE_SEND_PATH) {
    history = [
      sentRow('message-1', 'acceptance', 'speaker-a@example.test'),
      sentRow('message-2', 'acceptance', 'speaker-b@example.test'),
    ]
    return jsonResponse(history)
  }
  if (method === 'POST' && url === REMINDER_SEND_PATH) {
    const reminders = [
      sentRow('message-3', 'reminder', 'speaker-a@example.test'),
      sentRow('message-4', 'reminder', 'speaker-b@example.test'),
    ]
    history = [...history, ...reminders]
    return jsonResponse(reminders)
  }
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

function callsTo(path: string, method: string): number {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      requestUrl(input as RequestInfo) === path &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ).length
}

beforeEach(() => {
  history = []
  fetchHandler = defaultHandler
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(fetchHandler(requestUrl(input), init)),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <CommunicationsPanel slug="demo-conf-2026" submissionId={SUBMISSION_ID} />
    </QueryClientProvider>,
  )
}

describe('communications panel with reminders', () => {
  it('names the resolved audience before anything is sent', async () => {
    renderPanel()
    const audience = await screen.findByRole('list', { name: /audience/i })
    const items = within(audience).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('speaker-a@example.test'),
      expect.stringContaining('speaker-b@example.test'),
    ])
  })

  it('sends the acceptance to every recipient and disables the action', async () => {
    renderPanel()
    const send = await screen.findByRole('button', { name: /send acceptance/i })
    await userEvent.click(send)
    await waitFor(() => expect(callsTo(ACCEPTANCE_SEND_PATH, 'POST')).toBe(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send acceptance/i })).toBeDisabled(),
    )
    const historyList = screen.getByRole('list', { name: /send history/i })
    const rows = within(historyList).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('speaker-a@example.test')
    expect(rows[0]).toHaveTextContent(/acceptance/i)
  })

  it('sends the reminder separately and history shows both kinds per recipient', async () => {
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /send acceptance/i }))
    await waitFor(() => expect(callsTo(ACCEPTANCE_SEND_PATH, 'POST')).toBe(1))
    const reminder = await screen.findByRole('button', { name: /send reminder/i })
    await userEvent.click(reminder)
    await waitFor(() => expect(callsTo(REMINDER_SEND_PATH, 'POST')).toBe(1))
    const historyList = screen.getByRole('list', { name: /send history/i })
    await waitFor(() => expect(within(historyList).getAllByRole('listitem')).toHaveLength(4))
    const texts = within(historyList)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(texts.filter((text) => /reminder/i.test(text))).toHaveLength(2)
  })

  it('prevents a double submit while a send is in flight', async () => {
    let release: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url === ACCEPTANCE_SEND_PATH) {
        return new Promise<Response>((resolve) => {
          release = resolve
        })
      }
      return defaultHandler(url, init)
    }
    renderPanel()
    const send = await screen.findByRole('button', { name: /send acceptance/i })
    await userEvent.click(send)
    const pending = await screen.findByRole('button', { name: /sending acceptance/i })
    expect(pending).toBeDisabled()
    await userEvent.click(pending)
    release?.(
      jsonResponse([
        sentRow('message-1', 'acceptance', 'speaker-a@example.test'),
        sentRow('message-2', 'acceptance', 'speaker-b@example.test'),
      ]),
    )
    await waitFor(() => expect(callsTo(ACCEPTANCE_SEND_PATH, 'POST')).toBe(1))
  })

  it('shows a generic error and keeps the reminder usable when the server rejects', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url === REMINDER_SEND_PATH) {
        return jsonResponse({ error: { code: 'internal', message: 'raw sql detail' } }, 500)
      }
      return defaultHandler(url, init)
    }
    renderPanel()
    const reminder = await screen.findByRole('button', { name: /send reminder/i })
    await userEvent.click(reminder)
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(/raw sql detail/)
    expect(screen.getByRole('button', { name: /send reminder/i })).toBeEnabled()
  })
})
