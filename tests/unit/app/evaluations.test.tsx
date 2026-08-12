import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The page recovers an expired session by navigating, exactly as the committed
// CFP surfaces do. Only `useRouter` is stubbed so the real `createFileRoute`
// used by the route-contract cases below keeps working.
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useRouter: () => ({ navigate: navigateSpy }) }
})

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
  roundId: 'round-1',
  roundNumber: 1,
  roundName: 'Round 1',
  roundStatus: 'open',
  rating: 5,
  comments: 'Great session',
  updatedAt: '2026-05-13T12:00:00.000Z',
  previousRounds: [],
} as const

/** An assigned submission the evaluator has not scored yet. */
const UNSCORED_ROW = {
  submissionId: 'submission-1',
  sessionTitle: 'My talk',
  roundId: 'round-1',
  roundNumber: 1,
  roundName: 'Round 1',
  roundStatus: 'open',
  rating: null,
  comments: null,
  updatedAt: null,
  previousRounds: [],
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
  navigateSpy.mockClear()
  window.sessionStorage.clear()
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
    // Mounted and silent, not gone: the region the submit outcome will land in
    // has to be in the accessibility tree before its text arrives.
    expect(screen.getByRole('status')).toHaveTextContent('')
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

  it('offers a working retry from the error state instead of a dead end', async () => {
    const user = userEvent.setup()
    let fail = true
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        if (fail) {
          fail = false
          return jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
        }
        return jsonResponse([EVALUATION_ROW])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(EVALUATION_ROW.sessionTitle)).toBeInTheDocument()
  })

  it('states plainly that evaluations are not open when the API answers 404', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    // A 404 is not a failure and must not be shouted as one: there is nothing
    // to retry, so there is no retry control to press either.
    expect(await screen.findByText('Evaluations are not open yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('renders the empty state with the page h1 and No evaluations yet', async () => {
    await mountPage('empty')

    expect(await screen.findByText('No evaluations yet.')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  // R1-M2: both dead ends on this surface were hand-rolled — a card holding a
  // bare sentence — while every other empty surface in the product is the
  // shared dashed box with an icon tile, a title and an explanation.
  it.each([
    { state: 'empty' as const, title: 'No evaluations yet.', description: /an organizer assigns/i },
    {
      state: 'notFound' as const,
      title: 'Evaluations are not open yet.',
      description: /no review round taking ratings/i,
    },
  ])('renders the $state dead end in the shared empty-state grammar', async (expectation) => {
    if (expectation.state === 'empty') {
      await mountPage('empty')
    } else {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === EVALUATIONS_URL) {
          return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      await renderPage()
    }

    await screen.findByText(expectation.title)
    const empty = document.querySelector('[data-slot="empty-state"]')
    expect(empty).not.toBeNull()
    expect(empty?.querySelector('[data-slot="empty-state-icon"]')).not.toBeNull()
    expect(empty?.querySelector('[data-slot="empty-state-title"]')).toHaveTextContent(
      expectation.title,
    )
    expect(
      empty?.querySelector('[data-slot="empty-state-description"]')?.textContent ?? '',
    ).toMatch(expectation.description)
    // One live region per outcome (DEC-014): the title carries it.
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('renders evaluation rows labels-only (session title, rating, comments, updatedAt)', async () => {
    await mountPage('ready')

    await screen.findByRole('heading', { level: 1, name: 'Evaluations' })
    const rendered = document.body.textContent ?? ''
    expect(rendered).toContain(EVALUATION_ROW.sessionTitle)
    expect(rendered).toContain(String(EVALUATION_ROW.rating))
    expect(rendered).toContain(EVALUATION_ROW.comments)
    // `updatedAt` is still on the row, but it is no longer SHOWN as the wire
    // sent it: the visible text is words, and the ISO instant moves to the
    // `dateTime` attribute where a machine can still recover it exactly.
    const updated = document.querySelector(`time[datetime="${EVALUATION_ROW.updatedAt}"]`)
    expect(updated).not.toBeNull()
    expect(updated?.textContent).toBe('May 13, 2026, 12:00 PM')
    expect(rendered).not.toContain(EVALUATION_ROW.updatedAt)
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

  it('refuses to submit a rating the evaluator never chose', async () => {
    const user = userEvent.setup()
    let postCalls = 0
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) return jsonResponse([UNSCORED_ROW])
      if (method === 'POST' && url === EVALUATIONS_URL) {
        postCalls += 1
        return jsonResponse(EVALUATION_ROW)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Evaluations' })
    await user.click(screen.getByRole('button', { name: /submit/i }))

    // A one-star review is a verdict, so it has to be chosen rather than
    // arrived at by pressing Submit on an untouched control.
    expect(postCalls).toBe(0)
    const rating = screen.getByLabelText(/rating/i)
    expect(rating).toHaveAttribute('aria-invalid', 'true')
    const describedBy = rating.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(/a rating is required/i)
  })

  // This case submits without touching the rating control on purpose. The row
  // it renders is one the evaluator has already scored, so the control is
  // seeded from their own stored rating rather than from a default — pressing
  // Submit re-sends a verdict they chose earlier. The unscored row above is
  // what pins that an unchosen rating cannot be submitted at all.
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

  it('shows an unscored assignment as not yet scored rather than a rating of zero', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) return jsonResponse([UNSCORED_ROW])
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Evaluations' })
    expect(await screen.findByText(/not yet scored/i)).toBeInTheDocument()
    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toContain('Rating: 0')
    expect(rendered).not.toContain('Updated: ')
    expect(screen.getByLabelText(/rating/i)).toHaveValue('')
  })

  it('keeps the written justification on the wire when only the rating changes', async () => {
    const user = userEvent.setup()
    let postedBody: unknown = null
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) return jsonResponse([EVALUATION_ROW])
      if (method === 'POST' && url === EVALUATIONS_URL) {
        postedBody = JSON.parse(String(init?.body))
        return jsonResponse(EVALUATION_ROW)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    // The evaluator sees what they wrote, so a rating-only edit cannot silently
    // discard it.
    expect(await screen.findByLabelText(/comments/i)).toHaveValue('Great session')

    await user.selectOptions(screen.getByLabelText(/rating/i), '3')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    // The round travels with the answer. A reviewer can hold one proposal in
    // two open rounds, so a body naming only the proposal leaves the server to
    // guess which form was filled in — and it guesses the newest round, which
    // is how a round-one review used to land on round two.
    expect(postedBody).toEqual({
      submissionId: 'submission-1',
      roundId: 'round-1',
      rating: 3,
      comments: 'Great session',
    })
  })

  it('maps a 401 on submit to the expired-session state, not a generic alert', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) return jsonResponse([EVALUATION_ROW])
      if (method === 'POST' && url === EVALUATIONS_URL) {
        return jsonResponse(
          { error: { code: 'unauthorized', message: 'Session revoked raw copy' } },
          401,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /submit/i }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Session expired' }),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('Session revoked raw copy')
  })

  it('keeps the entered rating and comment across a 401 on submit', async () => {
    const user = userEvent.setup()
    let unauthorized = false
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) return jsonResponse([UNSCORED_ROW])
      if (method === 'POST' && url === EVALUATIONS_URL) {
        unauthorized = true
        return jsonResponse(
          { error: { code: 'unauthorized', message: 'Session revoked raw copy' } },
          401,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await user.selectOptions(await screen.findByLabelText(/rating/i), '4')
    await user.type(screen.getByLabelText(/comments/i), 'Worth keeping')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await screen.findByRole('heading', { level: 1, name: 'Session expired' })
    expect(unauthorized).toBe(true)

    // The evaluator signs in again and returns to a still-unscored row: the
    // work they typed has to come back with them, not be retyped from memory.
    cleanup()
    await renderPage()

    expect(await screen.findByLabelText(/rating/i)).toHaveValue('4')
    expect(screen.getByLabelText(/comments/i)).toHaveValue('Worth keeping')
  })

  it('recovers the session from the expired-session control instead of doing nothing', async () => {
    const user = userEvent.setup()
    await mountPage('expired')

    const again = await screen.findByRole('button', { name: /sign in again/i })
    await user.click(again)

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/start' })
  })

  it('names the round the evaluator is scoring and what they said in earlier ones', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse([
          {
            ...UNSCORED_ROW,
            roundId: 'round-2',
            roundNumber: 2,
            roundName: 'Round 2',
            previousRounds: [
              {
                roundNumber: 1,
                roundName: 'Round 1',
                rating: 5,
                comments: 'Round one view',
                updatedAt: '2026-05-13T12:00:00.000Z',
              },
            ],
          },
        ])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Evaluations' })
    expect(await screen.findByText(/round 2/i)).toBeInTheDocument()
    const rendered = document.body.textContent ?? ''
    expect(rendered).toContain('Round 1')
    expect(rendered).toContain('Round one view')
  })

  it('reads an earlier round in two inks and finally shows when it was recorded', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse([
          {
            ...UNSCORED_ROW,
            roundId: 'round-2',
            roundNumber: 2,
            roundName: 'Round 2',
            previousRounds: [
              {
                roundNumber: 1,
                roundName: 'Round 1',
                rating: 5,
                comments: 'Round one view',
                updatedAt: '2026-05-13T12:00:00.000Z',
              },
            ],
          },
        ])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Evaluations' })
    // Which round and what score is the scannable half, so it carries the
    // reading ink; the comment is the reading half and stays quiet.
    const headline = await screen.findByText(/Round 1: Round 1 — rated 5/)
    expect(headline).toHaveClass('font-medium', 'text-foreground')
    expect(screen.getByText('Round one view')).toHaveClass('text-muted-foreground')

    // `updatedAt` has always been on the wire and was never rendered: an
    // evaluator re-scoring in round two could not see when they recorded
    // round one.
    const recorded = headline.parentElement?.querySelector('time')
    expect(recorded).not.toBeNull()
    expect(recorded).toHaveAttribute('dateTime', '2026-05-13T12:00:00.000Z')
    const visible = recorded?.textContent ?? ''
    // The machine instant stays on the attribute. What a person reads is a
    // date, not an ISO-8601 string with a T and a Z in it.
    expect(visible).not.toContain('2026-05-13T12:00:00.000Z')
    expect(visible).toMatch(/2026/)

    // T4-b is rejected: the timestamp is audit content, so it wraps on a
    // narrow screen and is never hidden by a breakpoint. A phone and a desktop
    // must announce the same row.
    expect(recorded?.className ?? '').not.toMatch(/(^|[\s:])hidden\b/)
  })

  it('marks the round chip as a lifecycle state whether the round is open or closed', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse([
          { ...UNSCORED_ROW, submissionId: 'submission-open' },
          { ...UNSCORED_ROW, submissionId: 'submission-closed', roundStatus: 'closed' },
        ])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await screen.findByRole('heading', { level: 1, name: 'Evaluations' })
    const chips = Array.from(document.querySelectorAll('[data-slot="badge"]'))
    expect(chips).toHaveLength(2)
    // Open or closed is the round's lifecycle state, and it decides whether
    // anything below the header can still change — so both faces carry the
    // state marker, not just the tinted one.
    for (const chip of chips) {
      expect(chip).toHaveAttribute('data-dot', '')
    }
    expect(chips[1]?.textContent).toContain('(closed)')
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

  /**
   * An empty form posted, stored nothing, answered 200, and the reviewer was
   * told "Review saved" — so a blank review looked exactly like a recorded one.
   */
  it('refuses to report a review saved when nothing was answered', async () => {
    const user = userEvent.setup()
    let posted = 0
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse([
          {
            ...UNSCORED_ROW,
            criteria: [
              {
                id: 'criterion-1',
                label: 'Originality',
                kind: 'rating',
                weight: 1,
                scale: { min: 1, max: 5 },
                options: null,
                value: null,
              },
            ],
          },
        ])
      }
      if (method === 'POST' && url === EVALUATIONS_URL) {
        posted += 1
        return jsonResponse(UNSCORED_ROW)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /save review/i }))

    expect(await screen.findByText(/answer at least one question first/i)).toBeInTheDocument()
    expect(screen.queryByText(/review saved/i)).toBeNull()
    expect(posted).toBe(0)
  })

  /**
   * The rubric asks for this in the reviewer's own scoring view, and the point
   * of it is that the proposal stops being asked about — so the assertion is
   * that the request is made from there, not that a button exists.
   */
  it('lets the reviewer declare a conflict from the card they are scoring', async () => {
    const user = userEvent.setup()
    let recused: unknown = null
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) return jsonResponse([UNSCORED_ROW])
      if (method === 'POST' && url === `${EVALUATIONS_URL}/recuse`) {
        recused = JSON.parse(String(init?.body))
        return new Response(null, { status: 204 })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /declare a conflict of interest/i }))
    // Confirmed rather than instant: it cannot be undone from this surface, and
    // the dialog says so.
    await user.click(await screen.findByRole('button', { name: /^declare a conflict$/i }))

    await waitFor(() =>
      expect(recused).toEqual({ submissionId: 'submission-1', roundId: 'round-1' }),
    )
  })

  /**
   * A committee running two rounds at once hands one reviewer the same proposal
   * twice, each round asking its own questions. Everything on this screen used
   * to be identified by the proposal alone, so the two cards collided: one
   * React key for two children, one DOM id for two rating controls — which is
   * also what a screen reader and a label-based query resolve against — and one
   * write that could only ever name a single round.
   */
  it('gives each round its own card, its own controls and its own write', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === EVALUATIONS_URL) {
        return jsonResponse([
          { ...UNSCORED_ROW, roundId: 'round-1', roundNumber: 1, roundName: 'Screening' },
          { ...UNSCORED_ROW, roundId: 'round-2', roundNumber: 2, roundName: 'Final' },
        ])
      }
      if (method === 'POST' && url === EVALUATIONS_URL) {
        bodies.push(JSON.parse(String(init?.body)))
        return jsonResponse({ ...UNSCORED_ROW, rating: 4 })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    // Both rounds are on screen, each named, rather than the newest silently
    // standing in for both.
    expect(await screen.findByText(/Round 1: Screening/)).toBeInTheDocument()
    expect(screen.getByText(/Round 2: Final/)).toBeInTheDocument()

    // Two distinct rating controls: a shared id would make this query ambiguous
    // and would point both labels at the same field.
    const ratings = screen.getAllByLabelText(/rating/i)
    expect(ratings).toHaveLength(2)
    expect(new Set(ratings.map((control) => control.id)).size).toBe(2)

    await user.selectOptions(ratings[1]!, '4')
    await user.click(screen.getAllByRole('button', { name: /submit/i })[1]!)

    // The answer names the round it answers.
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ submissionId: 'submission-1', roundId: 'round-2', rating: 4 })
  })
})
