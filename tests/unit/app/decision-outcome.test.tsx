import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CommunicationsPanel from '../../../src/app/features/admin/CommunicationsPanel'
import PortalPage from '../../../src/app/features/public/PortalPage'
import { createQueryClient } from '../../../src/app/query-client'
import { resolveDecision, type PortalSubmission } from '../../../src/app/queries/portal'

/*
 * The decision a speaker is owed.
 *
 * An organizer could record an acceptance and nothing else: there was no
 * rejection anywhere in the product, so a proposal that was turned down was
 * indistinguishable, on the speaker's own page, from one nobody had looked at
 * yet. It read "Pending review" forever. This pins the third state.
 *
 * The wire field is `decision` — 'pending' | 'accepted' | 'rejected' — but the
 * payload that predates it carries only the `accepted` boolean, so every
 * assertion here comes in pairs: the new field decides when it is present, and
 * the old boolean still decides when it is not.
 */

const PORTAL_URL = '/api/public/submissions'

const BASE: PortalSubmission = {
  id: 'submission-1',
  title: 'Deterministic conflict detection at scale',
  status: 'pending',
  source: 'cfp',
  accepted: false,
  decision: 'pending',
  inviteAvailable: false,
  calendarEvent: null,
  formSlug: 'cfp',
  version: 1,
  coSpeakerCount: 0,
  submittedAt: '2026-05-01T09:00:00.000Z',
}

// The `legacy()` builder that made a pre-`decision` payload is gone with the
// case that used it. `decision` is required on the wire now, so a row without
// one is not a shape this product can produce, and a helper that manufactures
// impossible payloads only invites tests that certify behaviour nobody can
// reach.

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

/** Answers the portal read with these rows and nothing else. */
function serve(submissions: readonly unknown[]): void {
  fetchHandler = (url, init) => {
    if ((init?.method ?? 'GET') === 'GET' && url === PORTAL_URL) {
      return jsonResponse({ submissions })
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
}

beforeEach(() => {
  fetchHandler = () =>
    jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
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

function renderPortal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <PortalPage onUnauthenticated={vi.fn()} />
    </QueryClientProvider>,
  )
}

async function onlyRow(): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: /your submissions/i })
  const items = within(list).getAllByRole('listitem')
  expect(items).toHaveLength(1)
  return items[0] as HTMLElement
}

describe('resolveDecision', () => {
  // One vocabulary, three words, and undecided is a word like the others.
  // 'pending' no longer collapses to null: a surface that renders the outcome
  // should never have to distinguish "nobody decided" from "field missing",
  // because the server states an outcome on every row.
  it('reports the outcome the server stated, undecided included', () => {
    expect(resolveDecision({ ...BASE, decision: 'rejected' })).toBe('rejected')
    expect(resolveDecision({ ...BASE, decision: 'accepted' })).toBe('accepted')
    expect(resolveDecision({ ...BASE, decision: 'pending' })).toBe('pending')
  })

  // A stale `accepted: true` beside `decision: 'rejected'` is a contradiction
  // only one side can win, and the decision record is the newer fact. The
  // boolean is derived from a record a rejection deliberately leaves standing,
  // so it is precisely the field that must not be believed.
  it('lets the decision override a disagreeing boolean', () => {
    expect(resolveDecision({ ...BASE, decision: 'rejected', accepted: true })).toBe('rejected')
  })
})

describe('speaker-visible outcome', () => {
  it('reads Rejected for a rejected proposal', async () => {
    serve([{ ...BASE, decision: 'rejected' }])
    renderPortal()
    const row = await onlyRow()
    expect(row).toHaveTextContent(/rejected/i)
    expect(row).not.toHaveTextContent(/pending review/i)
  })

  it('reads Accepted for an accepted proposal', async () => {
    serve([
      {
        ...BASE,
        decision: 'accepted',
        accepted: true,
        inviteAvailable: true,
        calendarEvent: {
          uid: 'submission-1@open-events',
          title: BASE.title,
          start: '2026-05-14T10:00:00.000Z',
          end: '2026-05-14T11:00:00.000Z',
          location: 'Main Hall',
          description: '',
        },
      },
    ])
    renderPortal()
    const row = await onlyRow()
    expect(row).toHaveTextContent(/accepted/i)
    expect(row).not.toHaveTextContent(/rejected/i)
  })

  it('reads Pending review while nobody has decided', async () => {
    serve([{ ...BASE, decision: 'pending' }])
    renderPortal()
    const row = await onlyRow()
    expect(row).toHaveTextContent(/pending review/i)
    expect(row).not.toHaveTextContent(/rejected/i)
  })

  /*
   * REMOVED: 'keeps the old behaviour when the payload carries no decision
   * field'. That case pinned a compatibility fallback which no longer exists —
   * `decision` is required on the wire and the server states it on every row,
   * so a payload without one is not a shape this product can produce. Keeping
   * the test would have preserved the `accepted` boolean as a second source of
   * truth for the outcome, which is exactly what the field was introduced to
   * end.
   */

  // The invite belongs to the decision, not to a boolean that may lag it: a
  // rejected speaker must never be handed a calendar hold for the slot.
  //
  // This asserts the DOM only — that the link is not offered. It is NOT an
  // authorization guarantee and must not be read as one: hiding a link does not
  // stop anyone fetching /api/public/invite/:id.ics directly. The enforcement
  // lives server-side on the invite route and is pinned by an integration test.
  it('does not render a calendar invite link for a rejected proposal', async () => {
    serve([{ ...BASE, decision: 'rejected', accepted: true, inviteAvailable: true }])
    renderPortal()
    const row = await onlyRow()
    expect(within(row).queryByRole('link', { name: /calendar invite/i })).toBeNull()
  })

  // The chip is a lifecycle state in every one of the three faces, so all three
  // carry the marker that says so — the channel that survives greyscale.
  it('marks all three outcomes as lifecycle states', async () => {
    serve([
      { ...BASE, id: 'a', decision: 'pending' },
      { ...BASE, id: 'b', decision: 'accepted', accepted: true },
      { ...BASE, id: 'c', decision: 'rejected' },
    ])
    renderPortal()
    const list = await screen.findByRole('list', { name: /your submissions/i })
    const chips = within(list)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('[data-slot="badge"]'))
    for (const chip of chips) expect(chip).toHaveAttribute('data-dot', '')
    expect(chips[0]).toHaveTextContent(/pending review/i)
    expect(chips[1]).toHaveTextContent(/accepted/i)
    expect(chips[2]).toHaveTextContent(/rejected/i)
  })
})

/*
 * The organizer's half of the same gap.
 *
 * The panel could only ever record one outcome: there was an "Accept proposal"
 * button and nothing beside it, so an organizer who had decided against a
 * proposal had no way to say so and the speaker had nothing to read. Both
 * decisions are writable now, and — because either one is the thing an
 * organizer is about to tell a speaker — neither happens on a single click.
 */

const PANEL_SUBMISSION_ID = 'f0000000-0000-4000-8000-000000000900'
const PANEL_BASE = `/api/admin/events/demo-conf-2026/submissions/${PANEL_SUBMISSION_ID}`
const PREVIEW_PATH = `${PANEL_BASE}/acceptance-preview`
const REMINDER_PATH = `${PANEL_BASE}/reminder-preview`
const MESSAGES_PATH = `${PANEL_BASE}/messages`
const ACCEPT_PATH = `${PANEL_BASE}/accept`
const DECISION_PATH = `${PANEL_BASE}/decision`

/** Serves the panel's three reads with the decision under test. */
function servePanel(decision: 'pending' | 'accepted' | 'rejected'): void {
  const preview = {
    submissionId: PANEL_SUBMISSION_ID,
    toEmail: 'speaker-a@example.test',
    subject: 'Your proposal "Workshop proposal" is accepted for DemoConf 2026',
    body: 'Hi Speaker A,',
    accepted: decision === 'accepted',
    decision,
    alreadySent: false,
    audience: [{ email: 'speaker-a@example.test', alreadySent: false }],
  }
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === PREVIEW_PATH) return jsonResponse(preview)
    if (method === 'GET' && url === REMINDER_PATH) {
      return jsonResponse({ ...preview, kind: 'reminder' })
    }
    if (method === 'GET' && url === MESSAGES_PATH) return jsonResponse([])
    if (method === 'POST' && (url === ACCEPT_PATH || url === DECISION_PATH)) {
      return jsonResponse({ submissionId: PANEL_SUBMISSION_ID })
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
}

function mountPanel() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CommunicationsPanel slug="demo-conf-2026" submissionId={PANEL_SUBMISSION_ID} />
    </QueryClientProvider>,
  )
}

function decisionWrites(): number {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = requestUrl(input as RequestInfo | URL)
    return (
      ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST' &&
      (url === ACCEPT_PATH || url === DECISION_PATH)
    )
  }).length
}

describe('organizer decision control', () => {
  it('offers both outcomes while nothing has been decided', async () => {
    servePanel('pending')
    mountPanel()
    expect(await screen.findByRole('button', { name: 'Accept proposal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject proposal' })).toBeInTheDocument()
  })

  // The decision is a state the panel READS, not one inferred from which
  // buttons happen to be on screen.
  it('states the current decision in words, in all three cases', async () => {
    servePanel('pending')
    mountPanel()
    expect(await screen.findByText(/not yet decided/i)).toBeInTheDocument()
    cleanup()

    servePanel('accepted')
    mountPanel()
    expect(await screen.findByText(/^accepted$/i)).toBeInTheDocument()
    cleanup()

    servePanel('rejected')
    mountPanel()
    expect(await screen.findByText(/^rejected$/i)).toBeInTheDocument()
  })

  it('writes no rejection until the confirmation is confirmed', async () => {
    const user = userEvent.setup()
    servePanel('pending')
    mountPanel()
    await user.click(await screen.findByRole('button', { name: 'Reject proposal' }))
    // The ask is on screen and nothing has been written yet.
    expect(await screen.findByRole('button', { name: 'Confirm rejection' })).toBeInTheDocument()
    expect(decisionWrites()).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }))
    await waitFor(() => expect(decisionWrites()).toBe(1))
    // The verdict endpoint, carrying the verdict in the body — not a
    // path-per-outcome the server would have to keep in step with the UI.
    const rejection = fetchMock.mock.calls.find(
      ([input]) => requestUrl(input as RequestInfo | URL) === DECISION_PATH,
    )
    expect(rejection).toBeDefined()
    expect(JSON.parse(String((rejection?.[1] as RequestInit).body))).toEqual({
      decision: 'rejected',
    })
  })

  it('changes nothing when the rejection is cancelled', async () => {
    const user = userEvent.setup()
    servePanel('pending')
    mountPanel()
    await user.click(await screen.findByRole('button', { name: 'Reject proposal' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirm rejection' })).toBeNull(),
    )
    expect(decisionWrites()).toBe(0)
    // The proposal is exactly where it was, and both ways out are still open.
    expect(screen.getByText(/not yet decided/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject proposal' })).toBeInTheDocument()
  })

  it('writes no acceptance until the confirmation is confirmed', async () => {
    const user = userEvent.setup()
    servePanel('pending')
    mountPanel()
    await user.click(await screen.findByRole('button', { name: 'Accept proposal' }))
    expect(await screen.findByRole('button', { name: 'Confirm acceptance' })).toBeInTheDocument()
    expect(decisionWrites()).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Confirm acceptance' }))
    await waitFor(() => expect(decisionWrites()).toBe(1))
  })

  // Reversing a decision is a decision too, so it is asked the same way.
  it('asks again before a recorded decision is changed', async () => {
    const user = userEvent.setup()
    servePanel('accepted')
    mountPanel()
    const reject = await screen.findByRole('button', { name: 'Reject proposal' })
    await user.click(reject)
    const confirm = await screen.findByRole('button', { name: 'Confirm rejection' })
    // The question says which way it is turning, so it cannot be read as the
    // first decision on an undecided proposal.
    expect(screen.getByRole('dialog')).toHaveTextContent(/already been accepted|change/i)
    expect(decisionWrites()).toBe(0)
    await user.click(confirm)
    await waitFor(() => expect(decisionWrites()).toBe(1))
  })

  /*
   * What the confirmation has to say before an organizer commits.
   *
   * Not decoration: this is the whole reason the step exists. It names whose
   * proposal it is, states the consequence in the words the speaker's portal
   * will actually use, and is precise about reversibility — a decision here CAN
   * be changed until the speaker acts on it, so the copy must not borrow the
   * irreversibility language of the send dialogs beside it. The one truly
   * unrecallable thing is mail already sent.
   */
  it('names the speaker, the consequence and the reversibility before rejecting', async () => {
    const user = userEvent.setup()
    servePanel('pending')
    mountPanel()
    await user.click(await screen.findByRole('button', { name: 'Reject proposal' }))
    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveTextContent('speaker-a@example.test')
    expect(dialog).toHaveTextContent(/sees "Rejected" on their portal/i)
    expect(dialog).toHaveTextContent(/change this decision/i)
    // No email leaves the building on a decision — only the separate send does.
    expect(dialog).toHaveTextContent(/no email is sent/i)
    // The trap: this dialog sits beside two that genuinely cannot be undone.
    expect(dialog).not.toHaveTextContent(/cannot be undone|permanent/i)
  })

  // Reversing an ACCEPTED proposal is the one case with something genuinely
  // unrecallable in it, and only that part may say so.
  it('says what cannot be recalled when reversing an acceptance', async () => {
    const user = userEvent.setup()
    servePanel('accepted')
    mountPanel()
    await user.click(await screen.findByRole('button', { name: 'Reject proposal' }))
    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveTextContent(/already been accepted/i)
    expect(dialog).toHaveTextContent(/acceptance email.*cannot be recalled/i)
    // Still reversible as a decision, even though the mail is not.
    expect(dialog).toHaveTextContent(/change this decision/i)
  })

  // The server refuses a reversal the speaker has already acted on. That refusal
  // is the organizer's answer, not a generic failure, so it reaches them in the
  // server's own words and the decision on screen does not move.
  it('reports a refused reversal without claiming the decision changed', async () => {
    const user = userEvent.setup()
    servePanel('accepted')
    const serving = fetchHandler
    fetchHandler = (url, init) => {
      if ((init?.method ?? 'GET') === 'POST' && url === DECISION_PATH) {
        return jsonResponse(
          {
            error: {
              code: 'conflict',
              message:
                'That decision has been acted on by the speaker and can no longer be changed',
            },
          },
          409,
        )
      }
      return serving(url, init)
    }
    mountPanel()
    await user.click(await screen.findByRole('button', { name: 'Reject proposal' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm rejection' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/acted on by the speaker/i)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.getByText(/^Accepted$/)).toBeInTheDocument()
  })

  // Falls back exactly as the portal does: a payload with no `decision` is a
  // pre-field payload, and its `accepted` boolean still decides.
  /**
   * The organizer mirror of the removed portal case, inverted into the rule
   * that replaced it: a preview whose `accepted` boolean disagrees with its
   * verdict is read as the VERDICT. The boolean is derived from an acceptance
   * record that a rejection deliberately leaves standing, so `accepted: true`
   * beside `decision: 'rejected'` is the older of two facts, not a tie.
   */
  it('believes the verdict over a disagreeing accepted boolean', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === PREVIEW_PATH) {
        return jsonResponse({
          submissionId: PANEL_SUBMISSION_ID,
          toEmail: 'speaker-a@example.test',
          subject: 'subject',
          body: 'body',
          accepted: true,
          decision: 'rejected',
          alreadySent: false,
        })
      }
      if (method === 'GET' && url === MESSAGES_PATH) return jsonResponse([])
      if (method === 'GET' && url === REMINDER_PATH) return jsonResponse({ alreadySent: false })
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    mountPanel()
    expect(await screen.findByText(/^rejected$/i)).toBeInTheDocument()
  })
})
