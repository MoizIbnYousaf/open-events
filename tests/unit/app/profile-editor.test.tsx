import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProfileEditor from '../../../src/app/features/public/ProfileEditor'

// O3 P5: the portal profile editor reads and edits the real persisted
// name/bio, keeps email read-only, shows honest pending/error states with the
// established live-region conventions, and never fabricates a success.

const PROFILE_URL = '/api/public/profile'

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>
let stored: {
  name: string
  email: string
  bio: string | null
  jobTitle: string
  company: string
}

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
  if (method === 'GET' && url === PROFILE_URL) return jsonResponse(stored)
  if (method === 'PUT' && url === PROFILE_URL) {
    const body = JSON.parse(String(init?.body)) as {
      name: string
      bio: string | null
      jobTitle?: string
      company?: string
    }
    stored = {
      ...stored,
      name: body.name,
      bio: body.bio,
      jobTitle: body.jobTitle ?? stored.jobTitle,
      company: body.company ?? stored.company,
    }
    return jsonResponse(stored)
  }
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

beforeEach(() => {
  stored = {
    name: 'Speaker A',
    email: 'speaker-a@example.test',
    bio: null,
    jobTitle: '',
    company: '',
  }
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

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileEditor />
    </QueryClientProvider>,
  )
}

describe('portal profile editor', () => {
  it('loads and shows the persisted profile with a read-only email', async () => {
    renderEditor()
    expect(await screen.findByLabelText(/name/i)).toHaveValue('Speaker A')
    expect(screen.getByLabelText(/bio/i)).toHaveValue('')
    const email = screen.getByText('speaker-a@example.test')
    expect(email.closest('input, textarea')).toBeNull()
    expect(screen.getByLabelText(/job title/i)).toHaveValue('')
    expect(screen.getByLabelText(/company/i)).toHaveValue('')
  })

  it('saves the edited name and bio through the real endpoint', async () => {
    renderEditor()
    const name = await screen.findByLabelText(/name/i)
    await userEvent.clear(name)
    await userEvent.type(name, 'Ada Lovelace')
    await userEvent.type(screen.getByLabelText(/bio/i), 'First programmer.')
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await waitFor(() =>
      expect(stored).toMatchObject({ name: 'Ada Lovelace', bio: 'First programmer.' }),
    )
    expect(screen.getByText(/profile saved/i)).toBeInTheDocument()
  })

  it('shows a generic error and keeps edits when the server rejects', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'PUT' && url === PROFILE_URL) {
        return jsonResponse({ error: { code: 'validation_failed', message: 'raw internals' } }, 400)
      }
      return defaultHandler(url, init)
    }
    renderEditor()
    const name = await screen.findByLabelText(/name/i)
    await userEvent.clear(name)
    await userEvent.type(name, 'Ada')
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(/raw internals/)
    expect(screen.getByLabelText(/name/i)).toHaveValue('Ada')
    expect(screen.getByRole('button', { name: /save profile/i })).toBeEnabled()
  })
})
