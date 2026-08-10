import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PortalPage from '../../../src/app/features/public/PortalPage'

// Portal composition contract: the signed-in portal page presents the
// speaker's submissions, their onboarding checklist, and the headshot
// uploader together, so the speaker completes onboarding from one place.

const SUBMISSIONS = {
  submissions: [
    {
      id: 'submission-1',
      title: 'A talk about integration',
      status: 'accepted',
      formSlug: 'cfp',
      version: 1,
      coSpeakerCount: 0,
      submittedAt: '2026-05-01T09:00:00.000Z',
    },
  ],
} as const

const TASKS = {
  tasks: [
    {
      id: 'task-1',
      title: 'Confirm your profile and bio',
      status: 'pending',
      completedAt: null,
    },
  ],
} as const

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

beforeEach(() => {
  fetchHandler = (url) => {
    if (url === '/api/public/submissions') return jsonResponse(SUBMISSIONS)
    if (url === '/api/public/tasks') return jsonResponse(TASKS)
    if (url === '/api/public/profile/headshot') {
      return jsonResponse({ error: { code: 'not_found', message: 'none' } }, 404)
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(fetchHandler(requestUrl(input), init)),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('portal composition', () => {
  it('renders submissions, onboarding checklist, and headshot uploader together', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <PortalPage onUnauthenticated={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('A talk about integration')).toBeInTheDocument()
    expect(await screen.findByText('Confirm your profile and bio')).toBeInTheDocument()
    expect(await screen.findByLabelText(/upload a headshot/i)).toBeInTheDocument()
  })
})
