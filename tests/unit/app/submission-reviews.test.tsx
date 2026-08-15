import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormVersionDetailDto, SubmissionDetailDto } from '../../../src/application'
import SubmissionDetail from '../../../src/app/features/admin/SubmissionDetail'
import { createQueryClient } from '../../../src/app/query-client'

// What the committee said, on the page where the organizer decides.
//
// The organizer could staff a committee, open rounds and read a single
// unlabelled average — and nothing else. Who reviewed this proposal in which
// round, and what the criteria behind that average scored, were both on the
// wire and neither reached the screen. A decision made without them is a
// decision made on one number.

const EVENT_SLUG = 'demo-conf-2026'
const SUBMISSION_ID = 'submission-1'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'

const SUBMISSION_DETAIL: SubmissionDetailDto = {
  id: SUBMISSION_ID,
  eventId: EVENT_ID,
  formId: FORM_ID,
  formSlug: 'cfp',
  versionId: VERSION_ID,
  version: 1,
  status: 'pending',
  title: 'My talk',
  answers: { title: 'My talk' },
  routing: null,
  contributors: [
    {
      contactId: 'contact-1',
      name: 'Speaker A',
      email: 'speaker.a@example.test',
      role: 'primary',
      position: 0,
    },
  ],
  createdAt: '2026-08-08T12:00:00.000Z',
  submittedAt: '2026-08-08T12:00:00.000Z',
  editable: true,
  contentStatus: 'approved',
}

const FORM_VERSION_DETAIL: FormVersionDetailDto = {
  formId: FORM_ID,
  eventId: EVENT_ID,
  versionId: VERSION_ID,
  version: 1,
  status: 'draft',
  contentHash: null,
  publishedAt: null,
  updatedAt: '2026-08-08T09:00:00.000Z',
  pages: [{ id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: '' }],
  elements: [
    {
      id: 'e-1',
      pageId: 'p-1',
      position: 0,
      kind: 'question',
      fieldKey: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
  ],
  conditionRules: [],
  routingRules: [],
}

const ACCEPTANCE_PREVIEW = {
  submissionId: SUBMISSION_ID,
  kind: 'acceptance',
  toEmail: 'speaker.a@example.test',
  subject: 'Your proposal "My talk" is accepted for DemoConf 2026',
  body: 'Hi Speaker A,',
  accepted: false,
  alreadySent: false,
  audience: [{ email: 'speaker.a@example.test', alreadySent: false }],
}

const REMINDER_PREVIEW = { ...ACCEPTANCE_PREVIEW, kind: 'reminder', subject: 'Reminder' }

const ROUND_ONE = {
  id: 'round-1',
  eventId: EVENT_ID,
  number: 1,
  name: 'First pass',
  status: 'closed',
} as const

const ROUND_TWO = {
  id: 'round-2',
  eventId: EVENT_ID,
  number: 2,
  name: 'Shortlist',
  status: 'open',
} as const

const ASSIGNMENTS = [
  {
    id: 'assignment-1',
    eventId: EVENT_ID,
    roundId: 'round-1',
    submissionId: SUBMISSION_ID,
    evaluatorContactId: 'contact-9',
    evaluatorEmail: 'reviewer.one@example.test',
    evaluatorName: 'Reviewer One',
    createdAt: '2026-08-09T09:00:00.000Z',
  },
  {
    id: 'assignment-2',
    eventId: EVENT_ID,
    roundId: 'round-2',
    submissionId: SUBMISSION_ID,
    evaluatorContactId: 'contact-10',
    evaluatorEmail: 'reviewer.two@example.test',
    evaluatorName: 'Reviewer Two',
    createdAt: '2026-08-10T09:00:00.000Z',
  },
]

/**
 * A committee two rounds deep. Round 1 closed on two ratings across two
 * weighted criteria; round 2 is open and nobody has rated in it yet, so the two
 * rounds exercise the scored and the unscored face of the same section.
 */
const SUMMARY = {
  submissionId: SUBMISSION_ID,
  eventId: EVENT_ID,
  title: 'My talk',
  currentRoundId: 'round-2',
  assignmentCount: 1,
  scoredCount: 0,
  scoreCount: 0,
  weightSum: 0,
  weightedTotal: 0,
  weightedAverageCentis: 0,
  criteria: [],
  rounds: [
    {
      roundId: 'round-1',
      number: 1,
      name: 'First pass',
      status: 'closed',
      assignmentCount: 2,
      scoredCount: 2,
      scoreCount: 3,
      weightSum: 5,
      weightedTotal: 22,
      weightedAverageCentis: 440,
      criteria: [
        {
          criterionId: 'criterion-1',
          name: 'Relevance',
          weight: 3,
          scoreCount: 2,
          ratingSum: 9,
        },
        {
          criterionId: 'criterion-2',
          name: 'Speaker experience',
          weight: 2,
          scoreCount: 1,
          ratingSum: 4,
        },
      ],
      // `reviews` is a required field on the round summary, so every fixture
      // round carries one. Omitting it modelled a payload the server cannot
      // send, and the panel's old defensive cast hid that — an empty list here
      // is a round nobody has reviewed yet, which is a real state; an absent
      // one is not.
      reviews: [],
    },
    {
      roundId: 'round-2',
      number: 2,
      name: 'Shortlist',
      status: 'open',
      assignmentCount: 1,
      scoredCount: 0,
      scoreCount: 0,
      weightSum: 0,
      weightedTotal: 0,
      weightedAverageCentis: 0,
      criteria: [],
      reviews: [],
    },
  ],
}

const EMPTY_SUMMARY = {
  ...SUMMARY,
  currentRoundId: null,
  assignmentCount: 0,
  rounds: [],
}

/**
 * A reviewer's prose, with the punctuation and the paragraph break they typed.
 * Every character here is ordinary in a review and none of it may be mangled,
 * collapsed or escaped on its way to the organizer: an em dash, an apostrophe,
 * nested double quotes, a percent sign, a colon and a blank line between two
 * paragraphs.
 */
const COMMENT =
  'Strong opener, and the demo lands.\n\nBut: the middle third drags — I\'d cut the "live coding" section (20% of the runtime for 5% of the value).'

/** The round summary once the per-reviewer verdicts are carried on it. */
const REVIEWED_SUMMARY = {
  ...SUMMARY,
  rounds: [
    {
      ...SUMMARY.rounds[0],
      reviews: [
        {
          assignmentId: 'assignment-1',
          evaluatorName: 'Reviewer One',
          evaluatorEmail: 'reviewer.one@example.test',
          rating: 5,
          comment: COMMENT,
          updatedAt: '2026-08-11T09:00:00.000Z',
        },
        {
          assignmentId: 'assignment-3',
          evaluatorName: 'Reviewer Three',
          evaluatorEmail: 'reviewer.three@example.test',
          rating: 4,
          comment: null,
          updatedAt: '2026-08-11T10:00:00.000Z',
        },
      ],
    },
    SUMMARY.rounds[1],
  ],
}

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

const detailUrl = `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`
const versionUrl = `/api/admin/events/${EVENT_SLUG}/forms/${FORM_ID}/versions/${VERSION_ID}`
const previewUrl = `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}/acceptance-preview`
const reminderUrl = `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}/reminder-preview`
const messagesUrl = `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}/messages`
const roundsUrl = `/api/admin/events/${EVENT_SLUG}/rounds`
const assignmentsUrl = `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}/assignments`
const summaryUrl = `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}/evaluation-summary`

/** The page's reads, with the committee half swappable per test. */
function handlerWith(committee: {
  readonly rounds?: unknown
  readonly assignments?: unknown
  readonly summary?: unknown
}) {
  return (url: string, init?: RequestInit): Response => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      return jsonResponse({ error: { code: 'internal', message: 'unexpected write' } }, 500)
    }
    if (url === detailUrl) return jsonResponse(SUBMISSION_DETAIL)
    if (url === versionUrl) return jsonResponse(FORM_VERSION_DETAIL)
    if (url === previewUrl) return jsonResponse(ACCEPTANCE_PREVIEW)
    if (url === reminderUrl) return jsonResponse(REMINDER_PREVIEW)
    if (url === messagesUrl) return jsonResponse([])
    if (url === roundsUrl) return jsonResponse(committee.rounds ?? [ROUND_ONE, ROUND_TWO])
    if (url === assignmentsUrl) return jsonResponse(committee.assignments ?? ASSIGNMENTS)
    if (url === summaryUrl) return jsonResponse(committee.summary ?? SUMMARY)
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
}

async function mountDetail() {
  const rootRoute = createRootRoute()
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions',
    component: () => null,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions/$submissionId',
    component: SubmissionDetail,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, detailRoute]),
    history: createMemoryHistory({
      initialEntries: [`/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`],
    }),
  })
  await router.load()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

/**
 * The list item for one round inside the reviews section.
 *
 * Scoped to a list item on purpose: the assignment control names the same
 * rounds in its round picker, so a bare text query now legitimately matches a
 * heading and an <option>. Narrowing here keeps the ambiguity out of every
 * caller instead of renaming a control to suit a test.
 */
async function roundEntry(name: string): Promise<HTMLElement> {
  await screen.findAllByText(name)
  const items = screen
    .getAllByText(name)
    .map((element) => element.closest('li'))
    .filter((item): item is HTMLLIElement => item !== null)
  expect(items.length).toBeGreaterThan(0)
  return items[0] as HTMLElement
}

beforeEach(() => {
  fetchHandler = handlerWith({})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      fetchHandler(requestUrl(input), init),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('reviews on the organizer submission page', () => {
  // The roster was a flat list of names with no round on it, printed above a
  // separate list of round results. The organizer could see that two people
  // were on the committee and that some round averaged 4.40, and had no way to
  // tell which of those people that number came from.
  it('groups each reviewer under the round they reviewed in', async () => {
    await mountDetail()

    const first = await roundEntry('Round 1: First pass')
    expect(within(first).getByText('Reviewer One')).toBeInTheDocument()
    expect(within(first).getByText('reviewer.one@example.test')).toBeInTheDocument()
    expect(within(first).queryByText('Reviewer Two')).not.toBeInTheDocument()

    const second = await roundEntry('Round 2: Shortlist')
    expect(within(second).getByText('Reviewer Two')).toBeInTheDocument()
    expect(within(second).queryByText('Reviewer One')).not.toBeInTheDocument()
  })

  it('states the aggregate each round reached, beside the people who reached it', async () => {
    await mountDetail()

    const first = await roundEntry('Round 1: First pass')
    expect(first).toHaveTextContent('2 of 2 scored')
    expect(first).toHaveTextContent('weighted average 4.40')
  })

  // The per-criterion breakdown was on the wire from the first day the summary
  // existed and was never rendered, so the one number the organizer did get
  // could not be taken apart: a 4.40 built from a 4.50 on relevance and a 4.00
  // on experience is a different proposal from one built the other way round.
  it('breaks the weighted average into the criteria behind it', async () => {
    await mountDetail()

    const first = await roundEntry('Round 1: First pass')
    const criteria = within(first).getByRole('list', { name: /criteria/i })
    const [relevance, experience] = within(criteria).getAllByRole('listitem')

    expect(relevance).toHaveTextContent('Relevance')
    expect(relevance).toHaveTextContent('4.50')
    expect(relevance).toHaveTextContent('2 ratings')
    // Weight is what makes one criterion count more than another, so it is
    // stated rather than left implicit in a number nobody can reconstruct.
    expect(relevance).toHaveTextContent(/weight 3/i)

    expect(experience).toHaveTextContent('Speaker experience')
    expect(experience).toHaveTextContent('4.00')
    expect(experience).toHaveTextContent('1 rating')
    expect(experience).not.toHaveTextContent('1 ratings')
  })

  // A round nobody has rated in must not borrow the look of a result. It used
  // to be reachable only as a bare "0.00", which reads as a unanimous zero on a
  // 1-5 scale — the one rating the write side refuses outright.
  it('says an unrated round has no result rather than showing a zero', async () => {
    await mountDetail()

    const second = await roundEntry('Round 2: Shortlist')
    expect(second).toHaveTextContent(/no ratings recorded yet/i)
    expect(second.textContent ?? '').not.toContain('0.00')
  })

  // The defect itself: a reviewer records a rating AND a comment, both persist,
  // and the organizer deciding the proposal could read neither. A committee
  // whose verdicts stop at the database is a committee that was never consulted.
  it('shows each reviewer their own rating and the comment they wrote', async () => {
    fetchHandler = handlerWith({ summary: REVIEWED_SUMMARY })
    await mountDetail()

    const first = await roundEntry('Round 1: First pass')
    const reviews = within(first).getByRole('list', { name: /reviews in round 1/i })
    const [one, three] = within(reviews).getAllByRole('listitem')

    expect(one).toHaveTextContent('Reviewer One')
    expect(one).toHaveTextContent('reviewer.one@example.test')
    expect(one).toHaveTextContent('Rated 5 of 5')
    expect(one).toHaveTextContent(/live coding/)

    // A rating with no comment is a complete review, not a broken one: the row
    // carries the score and simply says nothing more.
    expect(three).toHaveTextContent('Reviewer Three')
    expect(three).toHaveTextContent('Rated 4 of 5')
    expect(three?.querySelector('p')).toBeNull()
  })

  // The reviewer's prose is evidence, so it arrives as they typed it. Assertions
  // here compare textContent exactly rather than through toHaveTextContent,
  // which normalises whitespace and would pass on a comment whose paragraph
  // break had been eaten.
  it('renders a comment with its punctuation and line breaks intact', async () => {
    fetchHandler = handlerWith({ summary: REVIEWED_SUMMARY })
    await mountDetail()

    const first = await roundEntry('Round 1: First pass')
    const comment = within(first).getByText(
      (_text, element) => element?.tagName === 'P' && element.textContent === COMMENT,
    )
    expect(comment.textContent).toBe(COMMENT)
    expect(comment.textContent).toContain('\n\n')
    expect(comment.textContent).toContain('—')
    expect(comment.textContent).toContain('"live coding"')
    expect(comment.textContent).toContain("I'd")
    // Printed whole, and the newlines the reviewer typed are painted rather
    // than collapsed by the default HTML whitespace rules.
    expect(comment.className).toContain('whitespace-pre-wrap')
  })

  // Until the verdicts are on the wire the section still has to say something
  // true, so a round with no reviews on it names the people it asked.
  it('falls back to naming who the round asked when no verdicts are carried', async () => {
    await mountDetail()

    const first = await roundEntry('Round 1: First pass')
    expect(within(first).queryByRole('list', { name: /reviews in round/i })).not.toBeInTheDocument()
    expect(within(first).getByText('Reviewer One')).toBeInTheDocument()
  })

  // An organizer opening a proposal before anyone has reviewed it saw an
  // unexplained gap between two headings.
  it('explains a proposal with no reviews instead of rendering an empty box', async () => {
    fetchHandler = handlerWith({ rounds: [], assignments: [], summary: EMPTY_SUMMARY })
    await mountDetail()
    await screen.findByRole('heading', { level: 1, name: 'My talk' })

    const empty = await screen.findByText('No reviews yet')
    expect(empty.closest('[data-slot="empty-state"]')).not.toBeNull()
    expect(document.body.textContent ?? '').not.toContain('4.40')
  })

  // DEC-014: the page carries a polite region from the communications panel as
  // well as this one, and two unlabelled role="status" nodes are indistinguishable
  // to a reader and to a query alike.
  it('names its own polite region so it is distinct from the other one on the page', async () => {
    await mountDetail()
    await screen.findByRole('heading', { level: 1, name: 'My talk' })

    const region = await screen.findByRole('status', { name: /review round/i })
    expect(region).toHaveTextContent(/round 2 is open/i)
  })
})
