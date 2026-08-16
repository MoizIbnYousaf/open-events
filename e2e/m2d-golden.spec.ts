import { expect, test, type Page } from '@playwright/test'

import { isConsoleNoise } from './helpers/console-noise'
import { isExpectedTurnstileLoaderRedirect } from './helpers/external-responses'
import { capturedMessages, countGoldenRows } from './helpers/golden-rows'
import { liveTestEmail } from './helpers/live-identity'

const EMAIL = liveTestEmail('golden-speaker')
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'

// Committed row-link accessible name (SubmissionList.tsx):
// `${title} — ${primarySpeaker.name}`; the seeded speaker's contact name is the
// normalized email (session.ts:138), so the primary speaker name in the row
// link is the email itself. The status token that used to sit between the two
// came out with F-R3-7 — the list cannot see acceptances, so it could not keep
// that token true.
const ORGANIZER_ROW_LINK_NAME = `My talk — ${EMAIL}`

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

// Chromium console companion of the exact expected empty-resource GET 404s
// listed in isExpectedException. Console and response events can arrive in
// either order, so they are reconciled after the page contexts close. Extra
// or unassociated 404 console messages remain evidence in consoleErrors.
const EXPECTED_404_CONSOLE_PATTERN =
  /Failed to load resource: the server responded with a status of 404 \((?:Not Found)?\)/

function unmatchedExpected404Messages(
  messages: readonly string[],
  expectedResponses: number,
): readonly string[] {
  return messages.slice(expectedResponses)
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
  // Optional portal artifacts do not exist for a first-time submitter.
  if (
    status === 404 &&
    method === 'GET' &&
    (url === '/api/public/profile/headshot' || url === '/api/public/profile/document')
  ) {
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
  let expected404ResponseCount = 0
  const expected404ConsoleMessages: string[] = []

  // Focused normalizer/count proof: mutation accounting keys on method +
  // pathname only — origin and query strings never leak into the counts.
  expect(
    [
      `http://localhost:4173/api/public/draft?formId=${FORM_ID}`,
      'http://localhost:4173/api/public/submit',
      'http://localhost:4173/api/public/session?token=abc123',
    ].map(normalizeEndpointPath),
  ).toEqual(['/api/public/draft', '/api/public/submit', '/api/public/session'])

  // Focused 404-console reconciliation proof: response and console events may
  // arrive in either order, but one exact expected response excuses at most
  // one matching message. Any surplus remains evidence.
  const sample404 = 'Failed to load resource: the server responded with a status of 404 (Not Found)'
  expect(unmatchedExpected404Messages([sample404], 1)).toEqual([])
  expect(unmatchedExpected404Messages([sample404, sample404], 1)).toEqual([sample404])
  expect(unmatchedExpected404Messages([sample404], 0)).toEqual([sample404])

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
      if (
        status !== 304 &&
        !isExpectedException(method, url, status) &&
        !isExpectedTurnstileLoaderRedirect(method, rawUrl, status)
      ) {
        unexpectedResponses.push(`${method} ${url} ${status}`)
      }
      return
    }
    // Each exact expected empty-resource GET grants one narrow console-message
    // match. An unassociated 404 must not grant a match. Response-level
    // unexpected-404 auditing is unchanged.
    if (status === 404 && method === 'GET' && isExpectedException(method, url, status)) {
      expected404ResponseCount += 1
    }
    if (!isExpectedException(method, url, status)) {
      unexpectedResponses.push(`${method} ${url} ${status}`)
    }
  }

  const attachPage = (page: Page) => {
    page.on('console', (message) => {
      if (message.type() !== 'error' && message.type() !== 'warning') return
      const text = message.text()
      if (isConsoleNoise(text)) return
      const location = message.location()
      const evidence = location.url
        ? `${text} @ ${location.url}:${location.lineNumber}:${location.columnNumber}`
        : text
      // Defer exact 404 correlation until contexts close because Chromium can
      // emit this console message before Playwright emits the response event.
      if (EXPECTED_404_CONSOLE_PATTERN.test(text)) {
        expected404ConsoleMessages.push(evidence)
        return
      }
      consoleErrors.push(evidence)
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
    await speakerPage.getByRole('button', { name: 'Request a link' }).click()
    await expect(speakerPage.getByText(/no inbox message will arrive/i)).toBeVisible()

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
    let capturedBody: readonly { readonly body: string }[]
    if (process.env.LIVE_ALLOW_MUTATION === 'acceptance') {
      capturedBody = await capturedMessages(EMAIL)
    } else {
      const captured = await organizerPage.request.get(`/api/dev/captured?email=${EMAIL}`)
      expect(captured.status()).toBe(200)
      recordResponse(captured, 'GET')
      capturedBody = (await captured.json()) as Array<{ body: string }>
    }
    const message = capturedBody[capturedBody.length - 1]
    expect(message, 'captured demo message exists').toBeDefined()
    const sessionPath = message?.body.split('Open your CFP session: ')[1]?.trim()
    expect(sessionPath, 'captured message exposes the session path').toBeDefined()
    expect(sessionPath).toMatch(/^https?:\/\/[^/]+\/api\/public\/session\?token=/)
    expect(new URL(sessionPath ?? '').origin).toBe(new URL(speakerPage.url()).origin)

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
    expect(sessionCookie?.secure).toBe(process.env.LIVE_ALLOW_MUTATION === 'acceptance')
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
    // The call asks for a real proposal now: format, track, abstract, audience
    // level and a key takeaway are all required, and Workshop is the format that
    // makes the conditional question appear AND mandatory.
    await speakerPage.getByLabel('Session format').selectOption('Workshop')
    await speakerPage.getByLabel('Track', { exact: true }).selectOption('Platform & Infra')
    await speakerPage.getByLabel('Proposal title').fill('My talk')
    await speakerPage
      .getByLabel('Abstract')
      .fill('How incremental builds cut a 40-minute CI pipeline down to minutes.')
    await speakerPage.getByLabel('Audience level').selectOption('Intermediate')
    await speakerPage
      .getByLabel('Key takeaway')
      .fill('Which incremental-build investments actually pay off.')
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
    // A saved draft now lands on the step holding the work, so no Next is needed
    // to reach it.
    await expect(speakerPage.getByLabel('Session format')).toHaveValue('Workshop')
    await expect(speakerPage.getByLabel('Workshop details')).toHaveValue(
      'An interactive workshop on accessibility.',
    )

    // 5. Participant step, then co-speaker + submit + focused confirmation.
    await speakerPage.getByRole('button', { name: 'Next' }).click()
    await speakerPage.getByLabel('Speaker bio').fill('Platform engineer working on build systems.')
    await speakerPage.getByRole('button', { name: 'Next' }).click()
    await speakerPage.getByRole('button', { name: 'Add co-speaker' }).click()
    await speakerPage.getByLabel('First name').fill('Ada')
    await speakerPage.getByLabel('Last name').fill('Lovelace')
    await speakerPage.getByLabel('Email').fill(liveTestEmail('golden-cospeaker'))
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
    consoleErrors.push(
      ...unmatchedExpected404Messages(expected404ConsoleMessages, expected404ResponseCount),
    )
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
