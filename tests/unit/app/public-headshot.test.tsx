import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HEADSHOT_MAX_BYTES } from '../../../src/application'
import HeadshotUploader from '../../../src/app/features/public/HeadshotUploader'
import {
  describeHeadshotRejection,
  getOwnHeadshot,
  publicHeadshotQueryKeys,
  putOwnHeadshot,
} from '../../../src/app/queries/public-headshot'
import { ApiClientError } from '../../../src/app/api/admin-events'
import { Toaster } from '../../../src/components/ui/sonner'
import {
  Route as HeadshotRoute,
  HeadshotPage as HeadshotRoutePage,
} from '../../../src/app/routes/_public/headshot'

// Headshot upload contract: GET /api/public/profile/headshot returns the raw
// bytes (404 means "none yet", not an error) and PUT sends the raw bytes with
// the file's content type. The page owns its h1, exposes a busy loading
// state, a real retry on the load error, an accessible file input, upload
// progress/status, and error states whose advertised retry actually works.

const HEADSHOT_URL = '/api/public/profile/headshot'

const HEADSHOT_DTO = {
  id: 'u0000000-0000-4000-8000-000000000001',
  contentType: 'image/png',
  sizeBytes: 64,
  createdAt: '2026-08-08T09:00:00.000Z',
  updatedAt: '2026-08-08T09:00:00.000Z',
} as const

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>
let createdObjectUrls: Blob[]
let revokedObjectUrls: string[]

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function envelopeResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status)
}

function pngResponse(byteLength = 64): Response {
  return new Response(new Uint8Array(byteLength).fill(9), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  })
}

function pngFile(name = 'me.png', size = 64, type = 'image/png'): File {
  return new File([new Uint8Array(size).fill(9)], name, { type })
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText(/upload a headshot/i)
}

function renderUploader() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <HeadshotUploader />
    </QueryClientProvider>,
  )
  return { queryClient }
}

beforeEach(() => {
  createdObjectUrls = []
  revokedObjectUrls = []
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        createdObjectUrls.push(blob)
        return `blob:headshot-${String(createdObjectUrls.length)}`
      },
      revokeObjectURL: (url: string) => {
        revokedObjectUrls.push(url)
      },
    }),
  )
  fetchHandler = () => pngResponse()
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    fetchHandler(requestUrl(input), init),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('public-headshot query module', () => {
  it('treats 404 as "no headshot yet" rather than an error', async () => {
    fetchHandler = () => envelopeResponse('not_found', 'Not found', 404)

    await expect(getOwnHeadshot()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] as RequestInfo)).toBe(HEADSHOT_URL)
  })

  it('returns the stored bytes and the served content type', async () => {
    fetchHandler = () => pngResponse(32)

    const headshot = await getOwnHeadshot()

    expect(headshot?.contentType).toBe('image/png')
    expect(headshot?.blob.size).toBe(32)
    expect(headshot?.blob.type).toBe('image/png')
  })

  it('surfaces the { error: { code, message } } envelope as an ApiClientError', async () => {
    fetchHandler = () => envelopeResponse('unauthorized', 'Session expired', 401)

    await expect(getOwnHeadshot()).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Session expired',
      status: 401,
    })
  })

  it('falls back to a safe code and message when the error body is not an envelope', async () => {
    fetchHandler = () => new Response('<html>boom</html>', { status: 500 })

    const error: unknown = await getOwnHeadshot().catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({ code: 'internal', message: 'Request failed', status: 500 })
  })

  it('PUTs the raw bytes with the file content type and returns the stored dto', async () => {
    fetchHandler = () => jsonResponse(HEADSHOT_DTO)

    await expect(putOwnHeadshot(pngFile())).resolves.toEqual(HEADSHOT_DTO)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('PUT')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'content-type': 'image/png' })
    expect((init.body as ArrayBuffer).byteLength).toBe(64)
  })

  it('rejects a failed PUT with the server envelope', async () => {
    fetchHandler = () => envelopeResponse('validation_failed', 'Validation failed', 413)

    await expect(putOwnHeadshot(pngFile())).rejects.toMatchObject({
      code: 'validation_failed',
      status: 413,
    })
  })

  it('uses a stable literal query key', () => {
    expect(publicHeadshotQueryKeys.own).toEqual(['public', 'headshot', 'own'])
  })

  it('mirrors the server envelope client-side, naming each rejection distinctly', () => {
    expect(describeHeadshotRejection(pngFile())).toBeNull()
    expect(describeHeadshotRejection(pngFile('doc.pdf', 64, 'application/pdf'))).toMatch(
      /JPEG, PNG, or WebP/i,
    )
    expect(describeHeadshotRejection(pngFile('big.png', HEADSHOT_MAX_BYTES + 1))).toMatch(/2 MB/i)
    expect(describeHeadshotRejection(pngFile('empty.png', 0))).toMatch(/empty/i)
    expect(describeHeadshotRejection(pngFile('empty.png', 0))).not.toMatch(/2 MB/i)
  })
})

describe('headshot route module', () => {
  it('exposes the documented /headshot path and renders the uploader', () => {
    expect(HeadshotRoute.options.path).toBe('/headshot')
    expect(HeadshotRoutePage).toBeTypeOf('function')
  })

  // The uploader is also composed into /portal, which owns its own h1, so the
  // page-owned heading belongs to the standalone route page, never to the
  // reusable section.
  it('gives the standalone page exactly one h1 while the section owns none', async () => {
    fetchHandler = () => envelopeResponse('not_found', 'Not found', 404)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <HeadshotRoutePage />
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/no headshot uploaded yet/i)).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: /headshot/i })).toBeInTheDocument()
  })
})

describe('HeadshotUploader', () => {
  it('owns a section heading, not an h1, and shows a busy loading state', async () => {
    fetchHandler = () => new Promise<Response>(() => undefined)

    renderUploader()

    expect(screen.getByRole('heading', { level: 2, name: /headshot/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(await screen.findByText(/loading your headshot/i)).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('shows a real empty state when no headshot is stored yet', async () => {
    fetchHandler = () => envelopeResponse('not_found', 'Not found', 404)

    renderUploader()

    expect(await screen.findByText(/no headshot uploaded yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders the stored headshot with meaningful alt text', async () => {
    renderUploader()

    const image = await screen.findByRole('img', { name: /your current headshot/i })
    expect(image).toHaveAttribute('src', 'blob:headshot-1')
  })

  it('falls back to the placeholder when the image will not decode, once and only once', async () => {
    renderUploader()

    const image = await screen.findByRole('img', { name: /your current headshot/i })
    const requestsBefore = fetchMock.mock.calls.length

    // An object URL can stop resolving after it was handed over — a revoked
    // blob, a signature that expired between fetch and paint. The browser's
    // own broken-image glyph used to paint inside our hairline ring.
    fireEvent.error(image)

    expect(await screen.findByText('No photo')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /your current headshot/i })).not.toBeInTheDocument()
    // The fallback is a decision about this URI, not a request: nothing is
    // re-fetched, and nothing re-fetches on any later render either.
    expect(fetchMock.mock.calls).toHaveLength(requestsBefore)
  })

  it('paints a replacement headshot after an earlier one failed to decode', async () => {
    const user = userEvent.setup()
    renderUploader()

    fireEvent.error(await screen.findByRole('img', { name: /your current headshot/i }))
    await screen.findByText('No photo')

    // The refusal is remembered against the URI that earned it, so a fresh
    // upload — a fresh object URL — is not condemned by the last one's
    // verdict.
    fetchHandler = (_url, init) =>
      init?.method === 'PUT' ? jsonResponse(HEADSHOT_DTO) : pngResponse()
    await user.upload(fileInput(), pngFile())

    expect(await screen.findByRole('img', { name: /your current headshot/i })).toBeInTheDocument()
  })

  it('offers a working "Try again" retry when the headshot fails to load', async () => {
    const user = userEvent.setup()
    fetchHandler = () => envelopeResponse('internal', 'Internal error', 500)

    renderUploader()

    expect(await screen.findByRole('alert')).toHaveTextContent(/unable to load your headshot/i)
    fetchHandler = () => pngResponse()
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByRole('img', { name: /your current headshot/i })).toBeInTheDocument()
  })

  it('uploads a picked file and re-reads the stored image from the server', async () => {
    const user = userEvent.setup()
    fetchHandler = () => envelopeResponse('not_found', 'Not found', 404)
    renderUploader()
    await screen.findByText(/no headshot uploaded yet/i)

    fetchHandler = (_url, init) =>
      init?.method === 'PUT' ? jsonResponse(HEADSHOT_DTO) : pngResponse()
    await user.upload(fileInput(), pngFile())

    expect(await screen.findByText(/headshot updated/i)).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /your current headshot/i })).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT'),
    ).toBe(true)
  })

  it('reports the upload once, and leaves the record on the surface', async () => {
    const user = userEvent.setup()
    fetchHandler = () => envelopeResponse('not_found', 'Not found', 404)
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <HeadshotUploader />
        <Toaster />
      </QueryClientProvider>,
    )
    await screen.findByText(/no headshot uploaded yet/i)

    fetchHandler = (_url, init) =>
      init?.method === 'PUT' ? jsonResponse(HEADSHOT_DTO) : pngResponse()
    await user.upload(fileInput(), pngFile())

    // Spoken once, by the toaster's permanent region. The label the uploader
    // keeps beside the re-read image is the durable record, not a second live
    // region repeating the same sentence (DEC-014, DEC-019).
    const notifications = await screen.findByRole('region', { name: /notifications/i })
    await waitFor(() => expect(notifications).toHaveTextContent('Headshot updated'))
    const confirmation = within(screen.getByRole('region', { name: /headshot/i })).getByText(
      'Headshot updated',
    )
    expect(confirmation).not.toHaveAttribute('role', 'status')
    expect(confirmation).not.toHaveAttribute('aria-live')
    expect(
      screen.queryAllByRole('status').filter((node) => node.textContent === 'Headshot updated'),
    ).toHaveLength(0)
  })

  it('rejects an unsupported file client-side without any upload request', async () => {
    // The picker itself filters on `accept`; the mirror still has to fail
    // closed for the paths (drag-and-drop, lax platforms) that do not.
    const user = userEvent.setup({ applyAccept: false })
    fetchHandler = () => envelopeResponse('not_found', 'Not found', 404)
    renderUploader()
    await screen.findByText(/no headshot uploaded yet/i)
    fetchMock.mockClear()

    await user.upload(fileInput(), pngFile('doc.pdf', 64, 'application/pdf'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/JPEG, PNG, or WebP/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fileInput().files).toHaveLength(0)
  })

  it('rejects an empty image client-side and leaves the input ready to retry', async () => {
    const user = userEvent.setup()
    fetchHandler = () => envelopeResponse('not_found', 'Not found', 404)
    renderUploader()
    await screen.findByText(/no headshot uploaded yet/i)
    fetchMock.mockClear()

    await user.upload(fileInput(), pngFile('empty.png', 0))

    expect(await screen.findByRole('alert')).toHaveTextContent(/empty/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fileInput().files).toHaveLength(0)
  })

  it.each([
    [413, 'validation_failed', /2 MB or less/i],
    [415, 'validation_failed', /not supported/i],
    [401, 'unauthorized', /session expired/i],
  ])('explains a %s upload failure', async (status, code, expected) => {
    const user = userEvent.setup()
    fetchHandler = (_url, init) =>
      init?.method === 'PUT'
        ? envelopeResponse(code, 'Rejected', status)
        : envelopeResponse('not_found', 'Not found', 404)
    renderUploader()
    await screen.findByText(/no headshot uploaded yet/i)

    await user.upload(fileInput(), pngFile())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(expected)
    })
  })

  it('clears the picked file after a failed upload so re-picking the same file retries', async () => {
    const user = userEvent.setup()
    fetchHandler = (_url, init) =>
      init?.method === 'PUT'
        ? envelopeResponse('internal', 'Internal error', 500)
        : envelopeResponse('not_found', 'Not found', 404)
    renderUploader()
    await screen.findByText(/no headshot uploaded yet/i)

    const file = pngFile()
    await user.upload(fileInput(), file)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/choose the file again to retry/i)
    })
    expect(fileInput().files).toHaveLength(0)

    fetchHandler = (_url, init) =>
      init?.method === 'PUT' ? jsonResponse(HEADSHOT_DTO) : pngResponse()
    await user.upload(fileInput(), file)

    expect(await screen.findByText(/headshot updated/i)).toBeInTheDocument()
  })

  it('refuses a pick made mid-upload out loud and leaves the input ready to retry it', async () => {
    const user = userEvent.setup()
    let releaseUpload: ((response: Response) => void) | undefined
    fetchHandler = (_url, init) => {
      if (init?.method === 'PUT') {
        return new Promise<Response>((resolve) => {
          releaseUpload = resolve
        })
      }
      return envelopeResponse('not_found', 'Not found', 404)
    }
    renderUploader()
    await screen.findByText(/no headshot uploaded yet/i)

    const first = pngFile('first.png')
    const second = pngFile('second.png')
    await user.upload(fileInput(), first)
    await screen.findByText(/uploading your headshot/i)

    // The control is intentionally not natively disabled — that throws focus to
    // <body> mid-flow — so a second pick is possible. It must be refused with a
    // message rather than swallowed, and the input must be emptied so the very
    // same file can be chosen again (an unchanged selection fires no change
    // event, which used to leave the control dead).
    await user.upload(fileInput(), second)
    expect(await screen.findByRole('alert')).toHaveTextContent(/still uploading/i)
    expect(fileInput().files).toHaveLength(0)
    expect(fileInput()).toHaveAttribute('aria-invalid', 'true')
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
      ),
    ).toHaveLength(1)

    fetchHandler = (_url, init) =>
      init?.method === 'PUT' ? jsonResponse(HEADSHOT_DTO) : pngResponse()
    releaseUpload?.(jsonResponse(HEADSHOT_DTO))
    await screen.findByText(/headshot updated/i)

    // The refusal describes a condition that ends on its own. Once the first
    // upload settles, "another headshot is still uploading" is false: leaving
    // it on screen gives one settled action both a success status and a
    // contradicting alert, and marks a control invalid that has nothing wrong
    // with it.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
    expect(screen.queryByText(/still uploading/i)).toBeNull()
    expect(fileInput()).not.toHaveAttribute('aria-invalid')
    expect(fileInput()).not.toHaveAttribute('aria-describedby')

    await user.upload(fileInput(), second)
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
        ),
      ).toHaveLength(2)
    })
  })

  it('reports the real failure once the upload a mid-flight pick was refused for fails', async () => {
    const user = userEvent.setup()
    let releaseUpload: ((response: Response) => void) | undefined
    fetchHandler = (_url, init) => {
      if (init?.method === 'PUT') {
        return new Promise<Response>((resolve) => {
          releaseUpload = resolve
        })
      }
      return envelopeResponse('not_found', 'Not found', 404)
    }
    renderUploader()
    await screen.findByText(/no headshot uploaded yet/i)

    await user.upload(fileInput(), pngFile('first.png'))
    await screen.findByText(/uploading your headshot/i)
    await user.upload(fileInput(), pngFile('second.png'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/still uploading/i)

    releaseUpload?.(envelopeResponse('internal', 'Internal error', 500))

    // The refusal must not outlive the flight it described and hide the
    // outcome of the upload that was actually running.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/choose the file again to retry/i)
    })
    expect(screen.queryByText(/still uploading/i)).toBeNull()
  })

  it('revokes the object URL it created when the uploader unmounts', async () => {
    renderUploader()
    await screen.findByRole('img', { name: /your current headshot/i })

    cleanup()

    expect(revokedObjectUrls).toContain('blob:headshot-1')
  })
})

describe('speaker upload sections share one empty grammar', () => {
  it('states the missing headshot in the content column, not the avatar column', async () => {
    fetchHandler = () => envelopeResponse('not_found', 'Not found', 404)
    renderUploader()

    const empty = await screen.findByText(/no headshot uploaded yet/i)
    const emptyBox = empty.closest('[data-slot="empty-state"]')
    expect(emptyBox).not.toBeNull()
    // The 112px avatar column holds the picture slot and nothing else.
    const placeholder = screen.getByText('No photo')
    expect(placeholder).not.toContainElement(empty)
    expect(placeholder.closest('[data-slot="empty-state"]')).toBeNull()
    // Same anatomy as the sibling supporting-document section: icon tile,
    // imperative title, explanation.
    expect(emptyBox?.querySelector('[data-slot="empty-state-icon"]')).not.toBeNull()
    expect(emptyBox).toHaveTextContent('Add your headshot')
  })

  it('drops the empty box once a headshot exists', async () => {
    renderUploader()

    await screen.findByAltText('Your current headshot')
    expect(screen.queryByText(/no headshot uploaded yet/i)).not.toBeInTheDocument()
  })

  it('holds both file inputs at the app control height', async () => {
    renderUploader()

    const input = await screen.findByLabelText('Upload a headshot')
    expect(input).toHaveClass('py-0')
    expect(input).not.toHaveClass('h-auto')
  })
})
