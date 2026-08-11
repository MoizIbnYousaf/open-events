import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentUploader from '../../../src/app/features/public/DocumentUploader'

// O3 P5: the supporting-document uploader sends the real bytes with the
// explicit x-file-name header, mirrors the server allow-list client-side with
// honest copy (PDF or plain text — no slides claim), and reports the stored
// document metadata after a re-read, never an optimistic success.

const DOCUMENT_URL = '/api/public/profile/document'

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>
let storedDocument: { fileName: string; contentType: string; sizeBytes: number } | null

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
  if (method === 'PUT' && url === DOCUMENT_URL) {
    const headers = new Headers(init?.headers)
    storedDocument = {
      fileName: headers.get('x-file-name') ?? '',
      contentType: headers.get('content-type') ?? '',
      sizeBytes: 3,
    }
    return jsonResponse({ id: 'doc-1', updatedAt: '2026-08-10T09:00:00.000Z', ...storedDocument })
  }
  if (method === 'GET' && url === DOCUMENT_URL) {
    if (storedDocument === null) {
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
    }
    return new Response(new Uint8Array([1, 2, 3]).buffer, {
      status: 200,
      headers: { 'content-type': storedDocument.contentType },
    })
  }
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

beforeEach(() => {
  storedDocument = null
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

function renderUploader() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <DocumentUploader />
    </QueryClientProvider>,
  )
}

describe('supporting document uploader', () => {
  it('claims only pdf/plain-text support and shows the empty state honestly', async () => {
    renderUploader()
    expect(await screen.findByText(/no supporting document/i)).toBeInTheDocument()
    const copy = document.body.textContent ?? ''
    expect(copy).toMatch(/pdf/i)
    expect(copy).not.toMatch(/slide|pptx|keynote/i)
    expect(screen.getByLabelText(/supporting document/i, { selector: 'input' })).toBeRequired()
  })

  it('uploads the picked file with its name in the explicit header', async () => {
    renderUploader()
    const input = (await screen.findByLabelText(/supporting document/i, {
      selector: 'input',
    })) as HTMLInputElement
    const file = new File(['abc'], 'outline.pdf', { type: 'application/pdf' })
    await userEvent.upload(input, file)
    await waitFor(() => expect(storedDocument?.fileName).toBe('outline.pdf'))
    expect(storedDocument?.contentType).toBe('application/pdf')
    expect(await screen.findByText('outline.pdf')).toBeInTheDocument()
  })

  it('refuses a disallowed type client-side without a network write', async () => {
    renderUploader()
    const input = (await screen.findByLabelText(/supporting document/i, {
      selector: 'input',
    })) as HTMLInputElement
    const file = new File(['abc'], 'deck.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    await userEvent.upload(input, file, { applyAccept: false })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/pdf|plain text|not supported/i)
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'PUT',
      ),
    ).toBe(false)
  })

  it('surfaces a server rejection as a generic alert', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'PUT' && url === DOCUMENT_URL) {
        return jsonResponse({ error: { code: 'validation_failed', message: 'sql detail' } }, 413)
      }
      return defaultHandler(url, init)
    }
    renderUploader()
    const input = (await screen.findByLabelText(/supporting document/i, {
      selector: 'input',
    })) as HTMLInputElement
    await userEvent.upload(input, new File(['abc'], 'big.pdf', { type: 'application/pdf' }))
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(/sql detail/)
  })
})
