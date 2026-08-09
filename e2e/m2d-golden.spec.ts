import { expect, test, type Page } from '@playwright/test'

import { countGoldenRows } from './helpers/golden-rows'

const EMAIL = 'golden-speaker@example.test'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'

// Committed row-link accessible name (SubmissionList.tsx:107):
// `${title} — ${statusText} — ${primarySpeaker.name}`; the seeded speaker's
// contact name is the normalized email (session.ts:138), so the primary
// speaker name in the row link is the email itself.
const ORGANIZER_ROW_LINK_NAME = `My talk — Pending — ${EMAIL}`

// Explicit mutation accounting: every 2xx write in the whole journey must
// match this normalized endpoint + method + intended-count map. A 2xx
// mutation on an endpoint outside the map is flagged immediately with the
// request logged; count drift (an extra or missing write) fails at the end of
// the journey with the actual request map logged. Reads (GET/HEAD/OPTIONS
// 2xx) are not mutation-checked.
const EXPECTED_MUTATIONS: Readonly<Record<string, number>> = {
  'POST /api/public/start': 1,
  'PUT /api/public/draft': 1,
  'POST /api/public/submit': 1,
  'POST /api/admin/session': 1,
}
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Dev-server/HMR console noise is excluded from the user-facing error list.
const CONSOLE_NOISE_PATTERNS = [/^\[vite\]/, /Download the React DevTools/i]

// Chromium console companion of the EXPECTED active-draft GET 404 (see
// isExpectedException). It is consumed AT MOST ONCE per expected draft-404
// response — never blanket-suppressed: extra or unassociated 404 console
// messages remain evidence in consoleErrors.
const DRAFT_404_CONSOLE_PATTERN =
  /Failed to load resource: the server responded with a status of 404 \(Not Found\)/

// Narrow 404-console consumption state machine: each expected draft-404
// response adds one budget unit; a matching console message consumes at most
// one unit. Extra or unassociated 404 messages are NOT consumed.
function noteDraft404Response(pending: number): number {
  return pending + 1
}
function consumeDraft404Message(pending: number): { pending: number; consumed: boolean } {
  return pending > 0 ? { pending: pending - 1, consumed: true } : { pending: 0, consumed: false }
}

// Normalized endpoint for mutation accounting: origin and query strings are
// stripped so counts are keyed on method + pathname only.
function normalizeEndpointPath(rawUrl: string): string {
  return new URL(rawUrl).pathname
}

// Exception list for NON-2xx responses only. 2xx responses are handled in the
// 2xx branch of recordResponse: reads pass through, and the dev-only
// captured-link read is positively asserted at its call site (the live
// evidence path), so no 200 entry belongs here.
function isExpectedException(method: string, url: string, status: number): boolean {
  // Redeem 303: GET /api/public/session?token=...
  if (status === 303 && method === 'GET' && url.startsWith('/api/public/session?token=')) {
    return true
  }
  // No active draft yet: GET /api/public/draft?formId=<formId> -> 404.
  if (status === 404 && method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
    return true
  }
  return false
}

interface EvidencedRequest {
  readonly method: () => string
  readonly url: () => string
}

interface EvidencedResponse {
  readonly status: () => number
  readonly url: () => string
  readonly request?: () => EvidencedRequest
}

test('golden journey: start to redeem to form to submit to organizer list/detail', async ({
  browser,
}) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const unexpectedResponses: string[] = []
  const mutationCounts = new Map<string, number>()
  let draft404ConsumeBudget = 0

  // Focused normalizer/count proof: mutation accounting keys on method +
  // pathname only — origin and query strings never leak into the counts.
  expect(
    [
      `http://localhost:4173/api/public/draft?formId=${FORM_ID}`,
      'http://localhost:4173/api/public/submit',
      'http://localhost:4173/api/public/session?token=abc123',
    ].map(normalizeEndpointPath),
  ).toEqual(['/api/public/draft', '/api/public/submit', '/api/public/session'])

  // Focused 404-console consumption proof: one expected draft-404 response
  // consumes exactly one matching console message; a second matching message
  // and a message with no expected response are NOT consumed (they remain
  // evidence in consoleErrors).
  let draft404Budget = 0
  draft404Budget = noteDraft404Response(draft404Budget)
  expect(draft404Budget).toBe(1)
  let consumeStep = consumeDraft404Message(draft404Budget)
  expect(consumeStep.consumed).toBe(true)
  expect(consumeStep.pending).toBe(0)
  consumeStep = consumeDraft404Message(consumeStep.pending)
  expect(consumeStep.consumed).toBe(false)
  expect(consumeDraft404Message(0).consumed).toBe(false)

  const recordRequestFailed = (request: EvidencedRequest) => {
    failedRequests.push(`${request.method()} ${request.url()}`)
  }

  const recordResponse = (response: EvidencedResponse, methodOverride?: string) => {
    const status = response.status()
    const method = methodOverride ?? response.request?.().method() ?? ''
    const rawUrl = response.url()
    const url = rawUrl.replace(new URL(rawUrl).origin, '')
    const endpoint = normalizeEndpointPath(rawUrl)
    // Successful responses: 2xx mutations must belong to the intended journey
    // map (normalized endpoint + method); anything else with a mutation method
    // is evidence. Reads pass through. Count drift is checked at the end.
    if (status >= 200 && status < 300) {
      if (MUTATION_METHODS.has(method)) {
        mutationCounts.set(
          `${method} ${endpoint}`,
          (mutationCounts.get(`${method} ${endpoint}`) ?? 0) + 1,
        )
        if (!(`${method} ${endpoint}` in EXPECTED_MUTATIONS)) {
          unexpectedResponses.push(`unexpected mutation ${method} ${endpoint} ${status}`)
        }
      }
      return
    }
    // Redirects/3xx: only the intended 303 redeem and benign 304 revalidation.
    if (status >= 300 && status < 400) {
      if (status !== 304 && !isExpectedException(method, url, status)) {
        unexpectedResponses.push(`${method} ${url} ${status}`)
      }
      return
    }
    // The EXACT expected active-draft GET 404 (isExpectedException requires the
    // full URL with formId) grants ONE narrow console-message consumption
    // budget unit; an unassociated 404 (different formId or path) must NOT
    // grant budget. Response-level unexpected-404 auditing is unchanged.
    if (status === 404 && method === 'GET' && isExpectedException(method, url, status)) {
      draft404ConsumeBudget = noteDraft404Response(draft404ConsumeBudget)
    }
    if (!isExpectedException(method, url, status)) {
      unexpectedResponses.push(`${method} ${url} ${status}`)
    }
  }

  const attachPage = (page: Page) => {
    page.on('console', (message) => {
      if (message.type() !== 'error' && message.type() !== 'warning') return
      const text = message.text()
      if (CONSOLE_NOISE_PATTERNS.some((pattern) => pattern.test(text))) return
      // Narrow 404 handling: consume AT MOST ONE matching console message per
      // expected draft-404 response; extra or unassociated 404 messages stay
      // in consoleErrors (no blanket /404/ suppression).
      if (DRAFT_404_CONSOLE_PATTERN.test(text)) {
        const step = consumeDraft404Message(draft404ConsumeBudget)
        draft404ConsumeBudget = step.pending
        if (step.consumed) return
      }
      consoleErrors.push(text)
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('requestfailed', recordRequestFailed)
    page.on('response', recordResponse)
  }

  const speaker = await browser.newContext()
  const speakerPage = await speaker.newPage()
  attachPage(speakerPage)
  let organizer: Awaited<ReturnType<typeof browser.newContext>> | undefined
  let organizerPage: Page | undefined
  let primaryError: unknown

  try {
    // 1. Real /start browser UI.
    await speakerPage.goto('/start')
    await expect(speakerPage.getByRole('heading', { level: 1, name: 'Start' })).toBeVisible()
    await speakerPage.getByLabel('Email').fill(EMAIL)
    await speakerPage.getByRole('button', { name: 'Start' }).click()
    await expect(speakerPage.getByText('Check your email')).toBeVisible()

    // 2. Organizer context: local-admin session + dev-captured link.
    organizer = await browser.newContext()
    organizerPage = await organizer.newPage()
    attachPage(organizerPage)
    const secret = process.env.LOCAL_ADMIN_TOKEN
    expect(secret, 'set LOCAL_ADMIN_TOKEN to run the local organizer proof').toBeTruthy()
    const session = await organizerPage.request.post('/api/admin/session', {
      data: { secret },
    })
    expect(session.status()).toBe(200)
    recordResponse(session, 'POST')
    const setCookie = session.headers()['set-cookie'] ?? ''
    expect(setCookie.toLowerCase()).toContain('httponly')
    // Organizer cookie jar, not document.cookie (HttpOnly cookies are never
    // visible there): the admin session stored its own HttpOnly sp_session in
    // the organizer context's jar.
    const organizerCookies = await organizer.cookies()
    const organizerSessionCookie = organizerCookies.find((cookie) => cookie.name === 'sp_session')
    expect(
      organizerSessionCookie,
      'organizer context holds its own HttpOnly admin session cookie',
    ).toBeDefined()
    expect(organizerSessionCookie?.httpOnly).toBe(true)

    // Dev-only captured-link read (plan exception list): positively asserted
    // here with the exact URL, method, and status 200 — the live evidence path
    // for the plan's dev-only captured-link exception.
    const captured = await organizerPage.request.get(`/api/dev/captured?email=${EMAIL}`)
    expect(captured.status()).toBe(200)
    recordResponse(captured, 'GET')
    const capturedBody = (await captured.json()) as Array<{ body: string }>
    const message = capturedBody[capturedBody.length - 1]
    expect(message, 'captured demo message exists').toBeDefined()
    const sessionPath = message?.body.split('Open your CFP session: ')[1]?.trim()
    expect(sessionPath, 'captured message exposes the session path').toBeDefined()
    expect(sessionPath).toMatch(/^\/api\/public\/session\?token=/)

    // 3. Speaker redeems: pin the 303 + Location before following, then the
    //    clean token-free URL, the HttpOnly session cookie attributes, and the
    //    public CFP surface.
    const redeemResponsePromise = speakerPage.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/public/session?token='),
    )
    await speakerPage.goto(sessionPath ?? '')
    const redeemResponse = await redeemResponsePromise
    expect(redeemResponse.status()).toBe(303)
    expect(redeemResponse.headers()['location']).toBe(`/cfp/${EVENT_SLUG}/${FORM_SLUG}`)
    await expect(speakerPage).toHaveURL(`/cfp/${EVENT_SLUG}/${FORM_SLUG}`)
    await expect(speakerPage).not.toHaveURL(/token=/)
    await expect(
      speakerPage.getByRole('heading', { level: 1, name: 'Call for papers' }),
    ).toBeVisible()
    expect(await speakerPage.evaluate(() => document.cookie)).not.toContain('sp_session')
    const speakerCookies = await speaker.cookies()
    const sessionCookie = speakerCookies.find((cookie) => cookie.name === 'sp_session')
    expect(sessionCookie, 'speaker sp_session cookie is present after redeem').toBeDefined()
    expect(sessionCookie?.httpOnly).toBe(true)
    expect(sessionCookie?.sameSite).toBe('Strict')
    expect(sessionCookie?.path).toBe('/')
    expect((sessionCookie?.expires ?? 0) > 0).toBe(true)
    expect(sessionCookie?.secure).toBe(false)
    // Session isolation: the organizer jar holds its own sp_session value, never
    // the speaker's — both sessions share the cookie name, so the values must be
    // distinct.
    const speakerToken = sessionCookie?.value
    const organizerToken = organizerCookies.find((cookie) => cookie.name === 'sp_session')?.value
    expect(speakerToken).toBeDefined()
    expect(organizerToken).toBeDefined()
    expect(organizerToken).not.toBe(speakerToken)

    // 4. Conditional reveal + required fields + save + refresh/resume.
    await speakerPage.getByRole('button', { name: 'Next' }).click()
    await speakerPage.getByLabel('Session format').selectOption('workshop')
    await speakerPage.getByLabel('Proposal title').fill('My talk')
    await expect(speakerPage.getByLabel('Workshop details')).toBeVisible()
    await speakerPage
      .getByLabel('Workshop details')
      .fill('An interactive workshop on accessibility.')
    await speakerPage.getByRole('button', { name: 'Save' }).click()
    await expect(speakerPage.getByRole('status').filter({ hasText: 'Saved' })).toContainText(
      'Saved',
    )

    await speakerPage.reload()
    await expect(
      speakerPage.getByRole('heading', { level: 1, name: 'Call for papers' }),
    ).toBeVisible()
    await speakerPage.getByRole('button', { name: 'Next' }).click()
    await expect(speakerPage.getByLabel('Session format')).toHaveValue('workshop')
    await expect(speakerPage.getByLabel('Workshop details')).toHaveValue(
      'An interactive workshop on accessibility.',
    )

    // 5. Co-speaker + submit + focused confirmation (single h1).
    await speakerPage.getByRole('button', { name: 'Next' }).click()
    await speakerPage.getByRole('button', { name: 'Next' }).click()
    await speakerPage.getByRole('button', { name: 'Add co-speaker' }).click()
    await speakerPage.getByLabel('First name').fill('Ada')
    await speakerPage.getByLabel('Last name').fill('Lovelace')
    await speakerPage.getByLabel('Email').fill('ada.lovelace@example.test')
    await speakerPage.getByRole('button', { name: 'Submit' }).click()
    await expect(
      speakerPage.getByRole('heading', { level: 1, name: 'Submission received' }),
    ).toBeVisible()
    await expect(speakerPage.getByRole('heading', { level: 1 })).toHaveCount(1)

    // 6. Persisted rows via the committed helper.
    const rows = countGoldenRows()
    expect(rows).toEqual({
      submissions: 1,
      contributors: 2,
      messages: 1,
      confirmations: 1,
      drafts: 0,
    })

    // 7. Organizer list/detail: exactly one pending row, immutable labels,
    //    version, and back link.
    await organizerPage.goto(`/admin/events/${EVENT_SLUG}/submissions`)
    const rowLink = organizerPage.getByRole('link', { name: ORGANIZER_ROW_LINK_NAME })
    await expect(rowLink).toHaveCount(1)
    await rowLink.click()
    await expect(organizerPage.getByRole('heading', { level: 1, name: 'My talk' })).toBeVisible()
    await expect(organizerPage.getByText('Pending')).toBeVisible()
    await expect(organizerPage.getByText(/version 1/i)).toBeVisible()
    await expect(organizerPage.getByText('Session format')).toBeVisible()
    await expect(organizerPage.getByText('Workshop details')).toBeVisible()
    const detailText = (await organizerPage.textContent('body')) ?? ''
    expect(detailText).not.toContain('workshop_details')
    const backLink = organizerPage.getByRole('link', { name: /back to submissions/i })
    await expect(backLink).toHaveAttribute('href', `/admin/events/${EVENT_SLUG}/submissions`)

    // 8. Mutation accounting: the whole journey's writes must match the
    //    intended map exactly — an extra or missing write fails here with the
    //    actual requests logged (2xx mutations outside the map were already
    //    flagged during the run).
    const actualMutations = Object.fromEntries(mutationCounts)
    expect(
      actualMutations,
      `mutation counts must match the intended journey writes; actual=${JSON.stringify(
        actualMutations,
      )} expected=${JSON.stringify(EXPECTED_MUTATIONS)}`,
    ).toEqual(EXPECTED_MUTATIONS)
  } catch (error) {
    primaryError = error
  } finally {
    await speaker.close()
    await organizer?.close()
    // Surface evidence even when an earlier journey step failed.
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
    expect(failedRequests).toEqual([])
    expect(unexpectedResponses).toEqual([])
  }
  if (primaryError !== undefined) {
    throw primaryError
  }
})
