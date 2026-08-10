import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getPublicEvaluations,
  submitEvaluation,
  usePublicEvaluations,
} from '../../../src/app/queries/public-evaluations'
import EvaluationsPage from '../../../src/app/features/public/EvaluationsPage'
import {
  Route as EvaluationsRoute,
  EvaluationsPage as EvaluationsRoutePage,
} from '../../../src/app/routes/_public/evaluations'

// Evaluation UI component contract for the public evaluations surface.
//
// Behavioral assumptions pinned by this contract (no invented semantics):
// 1. Evaluator actor = authenticated submitter (401 -> ExpiredSessionState,
//    403 -> ForbiddenState via AdminStates).
// 2. Rating scale = 1-5 integer.
// 3. One evaluation per evaluator per submission; re-submit is an idempotent
//    update (POST once, list refetches).
// 4. Comments optional.
// 5. Evaluations target published agenda sessions (submissionId).
// 6. GET /api/public/evaluations returns a JSON array of evaluation rows;
//    a 404 maps to null locally (committed public-helper pattern), 401/403/
//    5xx propagate.

const EVALUATIONS_URL = '/api/public/evaluations'

const EVALUATION_ROW = {
  submissionId: 'submission-1',
  sessionTitle: 'My talk',
  rating: 5,
  comments: 'Great session',
  updatedAt: '2026-05-13T12:00:00.000Z',
} as const

let fetchMock: ReturnType<typeof vi.fn>
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

async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <EvaluationsPage />
    </QueryClientProvider>,
  )
  return { queryClient }
}

type EvaluationsState = 'loading' | 'error' | 'denied' | 'expired' | 'empty' | 'ready'

async function mountPage(state: EvaluationsState) {
  if (state === 'loading') {
    fetchHandler = () => new Promise<Response>(() => undefined)
  } else if (state === 'error') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else if (state === 'denied') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse(
          { error: { code: 'forbidden', message: 'Access denied raw copy' } },
          403,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else if (state === 'expired') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse(
          { error: { code: 'unauthorized', message: 'Session revoked raw copy' } },
          401,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else if (state === 'empty') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse([])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse([EVALUATION_ROW])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  }
  return renderPage()
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === EVALUATIONS_URL) {
      return jsonResponse([EVALUATION_ROW])
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('evaluations UI', () => {
  it('registers the evaluations route with the production page', () => {
    expect(EvaluationsRoute.options.path).toBe('/evaluations')
    expect(EvaluationsRoute.options.component).toBe(EvaluationsRoutePage)
    expect(EvaluationsRoutePage).toBe(EvaluationsPage)
  })

  it.each([
    ['ready', 'Evaluations'],
    ['empty', 'Evaluations'],
    ['error', 'Evaluations'],
  ] as const)(
    'renders exactly one page-owned h1 in the %s state, never the brand',
    async (state, title) => {
      await mountPage(state)

      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
      const h1s = screen.getAllByRole('heading', { level: 1 })
      expect(h1s).toHaveLength(1)
      expect(h1s[0]).not.toHaveTextContent('SpeakerOps')
    },
  )

  it('keeps the loading state heading-free with aria-busy and a status, cleared after ready', async () => {
    let resolveEvaluations: ((response: Response) => void) | undefined
    fetchHandler = () =>
      new Promise<Response>((resolve) => {
        resolveEvaluations = resolve
      })
    await renderPage()

    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()

    resolveEvaluations?.(jsonResponse([EVALUATION_ROW]))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Evaluations' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('fetches exactly GET /api/public/evaluations with no unrelated calls', async () => {
    await mountPage('ready')

    await screen.findByRole('heading', { level: 1, name: 'Evaluations' })
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(EVALUATIONS_URL)
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')
  })

  it('maps a 401 to the expired-session state with a Sign in again action and no raw copy', async () => {
    await mountPage('expired')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Session expired' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('Session revoked raw copy')
  })

  it('maps a 403 to the forbidden state without raw copy', async () => {
    await mountPage('denied')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Access forbidden' }),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('Access denied raw copy')
  })

  it('shows generic error copy without raw server leakage', async () => {
    await mountPage('error')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load evaluations.')
    expect(document.body.textContent ?? '').not.toContain('boom raw server copy')
  })

  it('renders the empty state with the page h1 and No evaluations yet', async () => {
    await mountPage('empty')

    expect(await screen.findByText('No evaluations yet.')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('renders evaluation rows labels-only (session title, rating, comments, updatedAt)', async () => {
    await mountPage('ready')

    await screen.findByRole('heading', { level: 1, name: 'Evaluations' })
    const rendered = document.body.textContent ?? ''
    expect(rendered).toContain(EVALUATION_ROW.sessionTitle)
    expect(rendered).toContain(String(EVALUATION_ROW.rating))
    expect(rendered).toContain(EVALUATION_ROW.comments)
    expect(rendered).toContain(EVALUATION_ROW.updatedAt)
    expect(rendered).not.toContain('speaker.a@example.test')
    expect(rendered).not.toContain('contact-1')
  })

  it('exposes a labeled 1-5 rating control and optional labeled comments with a Submit action', async () => {
    const user = userEvent.setup()
    await mountPage('ready')

    const rating = await screen.findByLabelText(/rating/i)
    expect(rating).toBeInTheDocument()
    rating.focus()
    expect(rating).toHaveFocus()
    const comments = screen.getByLabelText(/comments/i)
    expect(comments).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
    await user.type(comments, 'Optional note')
  })

  it('submits exactly one POST, refetches the list, retains focus, and keeps raw copy out of failures', async () => {
    const user = userEvent.setup()
    let getCalls = 0
    let postCalls = 0
    let failSubmit = false
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        getCalls += 1
        return jsonResponse([EVALUATION_ROW])
      }
      if (method === 'POST' && url === EVALUATIONS_URL) {
        postCalls += 1
        return failSubmit
          ? jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
          : jsonResponse(EVALUATION_ROW)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    const submit = await screen.findByRole('button', { name: /submit/i })
    submit.focus()
    await user.click(submit)
    expect(postCalls).toBe(1)
    await waitFor(() => expect(getCalls).toBe(2))
    expect(submit).toHaveFocus()

    failSubmit = true
    await user.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent(/unable to submit/i)
    expect(document.body.textContent ?? '').not.toContain('boom raw server copy')
  })

  it('uses the committed query key for usePublicEvaluations', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    function Probe() {
      const query = usePublicEvaluations()
      return <div>{query.isSuccess ? 'loaded' : 'pending'}</div>
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    )

    await screen.findByText('loaded')
    expect(queryClient.getQueryState(['public', 'evaluations'])?.status).toBe('success')
  })

  it('getPublicEvaluations GETs the exact URL, maps 404 to null, and propagates 401/403/5xx', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse([EVALUATION_ROW])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    expect(await getPublicEvaluations()).toEqual([EVALUATION_ROW])
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(EVALUATIONS_URL)
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')

    fetchHandler = () => jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
    expect(await getPublicEvaluations()).toBeNull()
    fetchHandler = () => jsonResponse({ error: { code: 'unauthorized', message: 'x' } }, 401)
    await expect(getPublicEvaluations()).rejects.toThrow()
    fetchHandler = () => jsonResponse({ error: { code: 'forbidden', message: 'x' } }, 403)
    await expect(getPublicEvaluations()).rejects.toThrow()
    fetchHandler = () => jsonResponse({ error: { code: 'internal', message: 'x' } }, 500)
    await expect(getPublicEvaluations()).rejects.toThrow()
  })

  it('submitEvaluation POSTs the exact input exactly once with credentials include', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url === EVALUATIONS_URL) {
        return jsonResponse(EVALUATION_ROW)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    const input = { submissionId: 'submission-1', rating: 4, comments: 'Nice talk' }
    await submitEvaluation(input)

    expect(fetchMock.mock.calls).toHaveLength(1)
    const [urlInput, init] = fetchMock.mock.calls[0] ?? []
    expect(requestUrl(urlInput ?? '')).toBe(EVALUATIONS_URL)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })
})
