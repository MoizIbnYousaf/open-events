import { deflateSync } from 'node:zlib'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { capturedMessages, countLifecycleRows } from './helpers/golden-rows'

/**
 * O4 golden lifecycle: one deterministic browser journey across every frozen
 * SCOPE_FREEZE step 1-8 using the real surfaces — organizer configuration,
 * public CFP submission, evaluation, acceptance, portal onboarding with
 * persisted evidence, communications with immutable history and a stable-UID
 * invite, agenda placement with a deterministic conflict and its resolution,
 * publication, and the mobile public schedule.
 *
 * The product exposes UI for every transition below, and the journey uses it.
 * The ONLY API requests are the two dev-only captured-email reads (the inbox
 * has no UI by design) and the .ics download whose bytes a browser cannot
 * expose for parsing. Nothing is stubbed, seeded mid-run, or written to D1/R2
 * outside the app; the final bounded row-count helper is the one D1 read.
 *
 * Fine-grained validation-copy coverage (required/length/conditional errors)
 * stays in m2d-golden.spec.ts, which runs first in this same pinned config
 * against the same reset database.
 */

const SPEAKER_EMAIL = 'lifecycle-speaker@example.test'
const CO_SPEAKER_EMAIL = 'lifecycle-cospeaker@example.test'
const EVALUATOR_EMAIL = 'reviewer.one@example.test'
const TITLE = 'Lifecycle keynote'
const TITLE_B = 'Lifecycle workshop B'
const EVENT_SLUG = 'demo-conf-2026'
const FORM_SLUG = 'cfp'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VENUE = 'Lifecycle Hall'
const BIO = 'Keynote speaker and lifecycle enthusiast.'

// Committed row-link accessible name (SubmissionList.tsx): `${title} —
// ${primarySpeaker.name}`; the seeded speaker's contact name is the normalized
// email until the profile is saved.
//
// The status token used to sit in the middle of this string. It came out with
// F-R3-7: the list cannot see acceptances, so "Pending" stayed on a row whose
// proposal had already been accepted and emailed. A row's accessible name is
// which proposal this is, not what the list guesses has happened to it.
const ROW_LINK = (title: string) => `${title} — ${SPEAKER_EMAIL}`

const CHECKLIST_SIZE = 3

/** Stable published UID domain for the calendar invite (src/domain/invite.ts). */
const INVITE_UID_DOMAIN = 'speakerops'

// Explicit mutation accounting: every 2xx write in the whole journey must
// match this normalized endpoint + method + intended-count map exactly. Path
// UUIDs collapse to `:id`; the event slug stays literal because the canonical
// admin routes are event-scoped by design.
const EXPECTED_MUTATIONS: Readonly<Record<string, number>> = {
  'POST /api/public/start': 3, // one per speaker proposal + the evaluator
  'POST /api/admin/session': 1, // organizer signs in through /admin
  'PUT /api/public/draft': 2, // one explicit draft save per proposal
  'POST /api/public/submit': 2, // featured + conflict-partner proposal
  [`POST /api/admin/events/${EVENT_SLUG}/submissions/:id/accept`]: 2,
  [`POST /api/admin/events/${EVENT_SLUG}/criteria`]: 1,
  [`POST /api/admin/events/${EVENT_SLUG}/rounds`]: 1, // open round 2
  [`POST /api/admin/events/${EVENT_SLUG}/rounds/:id/close`]: 1, // seeded round 1

  [`POST /api/admin/events/${EVENT_SLUG}/submissions/:id/assignments`]: 1,
  'POST /api/public/evaluations': 1,
  [`PATCH /api/admin/events/${EVENT_SLUG}`]: 1, // venue edit on event settings
  'PUT /api/public/profile': 1,
  'PUT /api/public/profile/headshot': 1,
  'PUT /api/public/profile/document': 1,
  'POST /api/public/tasks/:id/complete': 3, // bio, headshot, confirmation
  [`POST /api/admin/events/${EVENT_SLUG}/submissions/:id/acceptance-send`]: 1,
  [`POST /api/admin/events/${EVENT_SLUG}/submissions/:id/reminder-send`]: 1,
  [`PUT /api/admin/events/${EVENT_SLUG}/agenda/:id`]: 3, // place, place, re-place
  [`POST /api/admin/events/${EVENT_SLUG}/agenda/publish`]: 1,
}
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Dev-server/HMR console noise is excluded from the user-facing error list.
const CONSOLE_NOISE_PATTERNS = [/^\[vite\]/, /Download the React DevTools/i]

// Chromium console companion of an EXPECTED 404 read (see isExpectedException).
// Consumed AT MOST ONCE per expected 404 response — never blanket-suppressed.
const EXPECTED_404_CONSOLE_PATTERN =
  /Failed to load resource: the server responded with a status of 404 \((?:Not Found)?\)/

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const UUID_PATTERN = new RegExp(UUID_SOURCE, 'gi')
const SINGLE_UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'i')

function normalizeEndpointPath(rawUrl: string): string {
  return new URL(rawUrl).pathname.replace(UUID_PATTERN, ':id')
}

function note404Response(pending: number): number {
  return pending + 1
}
function consume404Message(pending: number): { pending: number; consumed: boolean } {
  return pending > 0 ? { pending: pending - 1, consumed: true } : { pending: 0, consumed: false }
}

/**
 * Exception list for NON-2xx responses only. Every entry is a read the
 * product makes on purpose before the corresponding row exists.
 */
function isExpectedException(method: string, url: string, status: number): boolean {
  if (status === 303 && method === 'GET' && url.startsWith('/api/public/session?token=')) {
    return true
  }
  if (status === 404 && method === 'GET' && url === `/api/public/draft?formId=${FORM_ID}`) {
    return true
  }
  if (status === 404 && method === 'GET' && url === '/api/public/profile/headshot') {
    return true
  }
  if (status === 404 && method === 'GET' && url === '/api/public/profile/document') {
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

/** RFC 5545 unfolding + property extraction — enough to prove a real invite. */
function parseCalendar(text: string): {
  readonly lines: readonly string[]
  readonly properties: ReadonlyMap<string, string>
} {
  const physical = text.split('\r\n')
  const lines: string[] = []
  for (const line of physical) {
    if (line.length === 0) continue
    if (line.startsWith(' ') && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''}${line.slice(1)}`
      continue
    }
    lines.push(line)
  }
  const properties = new Map<string, string>()
  for (const line of lines) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const name = line.slice(0, separator)
    if (name === 'BEGIN' || name === 'END') continue
    properties.set(name, line.slice(separator + 1))
  }
  return { lines, properties }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(typed), 0)
  return Buffer.concat([length, typed, checksum])
}

/** A genuinely decodable truecolour PNG — a real image, not a renamed stub. */
function buildHeadshotPng(size: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(2, 9)
  const stride = 1 + size * 3
  const raw = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * stride
    raw.writeUInt8(0, rowStart)
    for (let x = 0; x < size; x += 1) {
      const pixel = rowStart + 1 + x * 3
      raw.writeUInt8((x * 8) % 256, pixel)
      raw.writeUInt8((y * 8) % 256, pixel + 1)
      raw.writeUInt8(128, pixel + 2)
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Wait for transient notifications to leave before keyboard navigation or an
 * axe scan. This is condition-based (not a sleep) and mirrors an unhurried
 * keyboard user; it also keeps Sonner's enter/exit opacity out of axe's sample.
 */
async function waitForTransientToasts(page: Page): Promise<void> {
  const dismissButtons = page.getByRole('button', { name: 'Dismiss notification' })
  await expect(dismissButtons).toHaveCount(0, { timeout: 15_000 })
}

/**
 * Keyboard evidence for a central transition: walk real Tab stops until the
 * target is focused (bounded), assert visible focus, then activate it with a
 * genuine Enter and await the resulting mutation.
 */
async function activateByKeyboard(
  page: Page,
  roleName: string,
  awaitResponse?: { readonly method: string; readonly pathIncludes: string },
): Promise<void> {
  await waitForTransientToasts(page)
  const target = page.getByRole('button', { name: roleName })
  await expect(target).toBeVisible()
  let reached = false
  const seen: string[] = []
  for (let i = 0; i < 200; i += 1) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => {
      const active = document.activeElement
      return (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim()
    })
    if (seen[seen.length - 1] !== label) seen.push(label)
    if (label === roleName) {
      reached = true
      break
    }
    if (seen.length > 4 && seen.filter((entry) => entry === label).length > 2) break
  }
  expect(reached, `keyboard reaches "${roleName}"; walked: ${seen.slice(-12).join(' | ')}`).toBe(
    true,
  )
  // The focused element IS the target and the browser paints its focus.
  const focusedVisibly = await target.evaluate(
    (element) =>
      element === document.activeElement &&
      (element.matches(':focus-visible') || element.matches('[data-focus-visible]')),
  )
  expect(focusedVisibly, `"${roleName}" is focused with visible focus`).toBe(true)
  if (awaitResponse !== undefined) {
    const settled = page.waitForResponse(
      (response) =>
        response.request().method() === awaitResponse.method &&
        response.url().includes(awaitResponse.pathIncludes),
    )
    await page.keyboard.press('Enter')
    const response = await settled
    expect(response.status(), `${roleName} mutation succeeds`).toBe(200)
  } else {
    await page.keyboard.press('Enter')
  }
}

/** Axe gate: zero serious/critical findings on a principal journey state. */
async function expectNoSeriousAxeFindings(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  const severe = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )
  expect(
    severe.map(
      (violation) =>
        `${label}: ${violation.id} (${violation.impact}) at ${violation.nodes
          .slice(0, 4)
          .map((node) => node.target.join(' '))
          .join(' ; ')}`,
    ),
    `axe on ${label}`,
  ).toEqual([])
}

test('golden lifecycle: configure, submit, evaluate, accept, onboard, communicate, schedule, publish', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  // No single action may silently consume the whole budget: every locator
  // action and navigation fails fast and names itself instead.
  let stage = 'init'
  const stageLog: string[] = []
  const enterStage = (name: string) => {
    stage = name
    stageLog.push(`${new Date().toISOString()} ${name}`)
  }
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const unexpectedResponses: string[] = []
  const mutationCounts = new Map<string, number>()
  let expected404ConsumeBudget = 0

  const recordRequestFailed = (request: EvidencedRequest) => {
    failedRequests.push(`${request.method()} ${request.url()}`)
  }

  const recordResponse = (response: EvidencedResponse, methodOverride?: string) => {
    const status = response.status()
    const method = methodOverride ?? response.request?.().method() ?? ''
    const rawUrl = response.url()
    const url = rawUrl.replace(new URL(rawUrl).origin, '')
    const endpoint = normalizeEndpointPath(rawUrl)
    if (status >= 200 && status < 300) {
      if (MUTATION_METHODS.has(method)) {
        const key = `${method} ${endpoint}`
        mutationCounts.set(key, (mutationCounts.get(key) ?? 0) + 1)
        if (!(key in EXPECTED_MUTATIONS)) {
          unexpectedResponses.push(`unexpected mutation ${key} ${status}`)
        }
      }
      return
    }
    if (status >= 300 && status < 400) {
      if (status !== 304 && !isExpectedException(method, url, status)) {
        unexpectedResponses.push(`${method} ${url} ${status}`)
      }
      return
    }
    if (status === 404 && method === 'GET' && isExpectedException(method, url, status)) {
      expected404ConsumeBudget = note404Response(expected404ConsumeBudget)
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
      if (EXPECTED_404_CONSOLE_PATTERN.test(text)) {
        const consumption = consume404Message(expected404ConsumeBudget)
        expected404ConsumeBudget = consumption.pending
        if (consumption.consumed) return
      }
      consoleErrors.push(text)
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('requestfailed', recordRequestFailed)
    page.on('response', recordResponse)
  }

  const speaker = await browser.newContext()
  const speakerPage = await speaker.newPage()
  speakerPage.setDefaultTimeout(15_000)
  speakerPage.setDefaultNavigationTimeout(20_000)
  attachPage(speakerPage)
  let organizer: Awaited<ReturnType<typeof browser.newContext>> | undefined
  let adminPageRef: Page | undefined
  let evaluator: Awaited<ReturnType<typeof browser.newContext>> | undefined
  let attendee: Awaited<ReturnType<typeof browser.newContext>> | undefined
  let primaryError: unknown

  try {
    // ── Step 1+2 (organizer): sign in through the real /admin UI and prove the
    //    event configuration is editable, persisted, and names the CFP.
    enterStage('organizer sign-in and event settings')
    organizer = await browser.newContext()
    adminPageRef = await organizer.newPage()
    const adminPage = adminPageRef
    adminPage.setDefaultTimeout(15_000)
    adminPage.setDefaultNavigationTimeout(20_000)
    attachPage(adminPage)
    const secret = process.env.LOCAL_ADMIN_TOKEN
    expect(secret, 'set LOCAL_ADMIN_TOKEN to run the local organizer proof').toBeTruthy()
    await adminPage.goto('/admin')
    await expect(adminPage.getByRole('heading', { level: 1, name: 'Admin sign in' })).toBeVisible()
    await adminPage.getByLabel('Organizer secret').fill(secret ?? '')
    await adminPage.getByRole('button', { name: 'Sign in' }).click()
    await expect(adminPage.getByRole('heading', { level: 1, name: 'Event settings' })).toBeVisible()
    const organizerCookies = await organizer.cookies()
    expect(organizerCookies.some((cookie) => cookie.httpOnly)).toBe(true)

    await adminPage.getByLabel('Venue').fill(VENUE)
    await adminPage.getByRole('button', { name: 'Save' }).click()
    await expect(adminPage.getByRole('status').filter({ hasText: 'Saved' })).toContainText('Saved')
    await adminPage.goto(`/admin/events/${EVENT_SLUG}`)
    await expect(adminPage.getByLabel('Venue')).toHaveValue(VENUE)
    // The published CFP is discoverable from the settings page.
    await expect(adminPage.getByRole('link', { name: FORM_SLUG, exact: true })).toBeVisible()

    // ── Step 3 (speaker): email-link start, redeem, conditional answer, draft,
    //    co-speaker, submit, confirmation — twice (the second proposal is the
    //    deterministic conflict partner for step 8).
    const startProposal = async (title: string, withCoSpeaker: boolean) => {
      await speakerPage.goto('/start')
      await expect(speakerPage.getByRole('heading', { level: 1, name: 'Start' })).toBeVisible()
      await speakerPage.getByLabel('Email').fill(SPEAKER_EMAIL)
      await speakerPage.getByRole('button', { name: 'Request a link' }).click()
      await expect(speakerPage.getByText('Check your email')).toBeVisible()

      let capturedBody: readonly { readonly body: string }[]
      if (process.env.LIVE_PRODUCTION === 'true') {
        capturedBody = capturedMessages(SPEAKER_EMAIL)
      } else {
        const captured = await adminPage.request.get(`/api/dev/captured?email=${SPEAKER_EMAIL}`)
        expect(captured.status()).toBe(200)
        recordResponse(captured, 'GET')
        capturedBody = (await captured.json()) as Array<{ body: string }>
      }
      // The inbox accumulates confirmations too; take the LAST session link.
      const sessionPath = capturedBody
        .map((message) => message.body.split('Open your CFP session: ')[1]?.trim())
        .filter((path): path is string => path !== undefined)
        .at(-1)
      expect(sessionPath, 'captured message exposes the session path').toBeDefined()
      await speakerPage.goto(sessionPath ?? '')
      await expect(speakerPage).toHaveURL(`/cfp/${EVENT_SLUG}/${FORM_SLUG}`)

      await speakerPage.getByRole('button', { name: 'Next' }).click()
      // The published call asks for a whole proposal: every required question has
      // to be answered before the wizard will advance, and Workshop is the format
      // whose rule makes the conditional question appear and mandatory.
      await speakerPage.getByLabel('Session format').selectOption('Workshop')
      await speakerPage.getByLabel('Track', { exact: true }).selectOption('Platform & Infra')
      await speakerPage.getByLabel('Proposal title').fill(title)
      await speakerPage
        .getByLabel('Abstract')
        .fill('A hands-on lifecycle session on incremental builds.')
      await speakerPage.getByLabel('Audience level').selectOption('Intermediate')
      await speakerPage.getByLabel('Key takeaway').fill('Where incremental builds pay off.')
      await speakerPage.getByLabel('Workshop details').fill('A hands-on lifecycle workshop.')
      await speakerPage.getByRole('button', { name: 'Save' }).click()
      await expect(speakerPage.getByRole('status').filter({ hasText: 'Saved' })).toContainText(
        'Saved',
      )
      // Committed wizard ordering (m2d-golden): the co-speaker card lives on
      // the participant step, two Next presses after the proposal fields.
      await speakerPage.getByRole('button', { name: 'Next' }).click()
      await speakerPage.getByLabel('Speaker bio').fill('Platform engineer on build systems.')
      await speakerPage.getByRole('button', { name: 'Next' }).click()
      if (withCoSpeaker) {
        await speakerPage.getByRole('button', { name: 'Add co-speaker' }).click()
        await speakerPage.getByLabel('First name').fill('Grace')
        await speakerPage.getByLabel('Last name').fill('Hopper')
        await speakerPage.getByLabel('Email').fill(CO_SPEAKER_EMAIL)
      }
      await speakerPage.getByRole('button', { name: 'Submit' }).click()
      await expect(
        speakerPage.getByRole('heading', { level: 1, name: 'Submission received' }),
      ).toBeVisible()
    }
    enterStage('speaker proposals')
    await startProposal(TITLE, true)
    await startProposal(TITLE_B, false)

    const speakerSession = (await speaker.cookies()).find((cookie) => cookie.name === 'sp_session')
    expect(speakerSession?.httpOnly, 'speaker holds a real HttpOnly session').toBe(true)

    // ── Step 4 (organizer): the submissions table lists both proposals; the
    //    featured detail shows linked answers.
    enterStage('organizer submissions list/detail')
    await adminPage.goto(`/admin/events/${EVENT_SLUG}/submissions`)
    const featuredRow = adminPage.getByRole('link', { name: ROW_LINK(TITLE) })
    await expect(featuredRow).toHaveCount(1)
    await expect(adminPage.getByRole('link', { name: ROW_LINK(TITLE_B) })).toHaveCount(1)
    await featuredRow.click()
    await expect(adminPage.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(adminPage.getByText('Workshop details')).toBeVisible()
    const submissionId = new URL(adminPage.url()).pathname.split('/').at(-1) ?? ''
    expect(submissionId).toMatch(SINGLE_UUID_PATTERN)
    await expectNoSeriousAxeFindings(adminPage, 'organizer submission detail')

    // ── Step 5 (evaluation): criteria + round through the committee UI, an
    //    assignment on the featured submission, and a weighted score entered
    //    through the evaluator's own UI.
    enterStage('evaluation setup and scoring')
    await adminPage.goto(`/admin/events/${EVENT_SLUG}/evaluations`)
    await expect(
      adminPage.getByRole('heading', { level: 1, name: 'Review committee' }),
    ).toBeVisible()
    await adminPage.getByLabel('Criterion name').fill('Depth')
    await adminPage.getByLabel('Weight').fill('2')
    await adminPage.getByRole('button', { name: 'Add criterion' }).click()
    await expect(adminPage.getByText('Depth')).toBeVisible()
    // The reset seed already opens Round 1 with an 'Overall fit' criterion;
    // the journey runs a real round transition instead: close the seeded
    // round through the UI and open round 2.
    // Both transitions go through the confirm rung: closing is one-way, and
    // opening moves what the whole committee is scoring.
    await expect(adminPage.getByText('Round 1 is open.')).toBeVisible()
    await adminPage.getByRole('button', { name: 'Close round 1' }).click()
    await adminPage.getByRole('button', { name: 'Confirm close' }).click()
    await expect(adminPage.getByText('No review round is open.')).toBeVisible()
    await adminPage.getByRole('button', { name: 'Open round 2' }).click()
    await adminPage.getByRole('button', { name: 'Confirm open' }).click()
    await expect(adminPage.getByText('Round 2 is open.')).toBeVisible()

    // The evaluator identity must exist before assignment resolves the email.
    evaluator = await browser.newContext()
    const evaluatorPage = await evaluator.newPage()
    evaluatorPage.setDefaultTimeout(15_000)
    evaluatorPage.setDefaultNavigationTimeout(20_000)
    attachPage(evaluatorPage)
    await evaluatorPage.goto('/start')
    await evaluatorPage.getByLabel('Email').fill(EVALUATOR_EMAIL)
    await evaluatorPage.getByRole('button', { name: 'Request a link' }).click()
    await expect(evaluatorPage.getByText('Check your email')).toBeVisible()

    await adminPage.goto(`/admin/events/${EVENT_SLUG}/submissions/${submissionId}`)
    await adminPage.getByLabel('Evaluator email').fill(EVALUATOR_EMAIL)
    await adminPage.getByRole('button', { name: 'Assign evaluator' }).click()
    await expect(adminPage.getByText(EVALUATOR_EMAIL)).toBeVisible()

    let evaluatorLinks: readonly { readonly body: string }[]
    if (process.env.LIVE_PRODUCTION === 'true') {
      evaluatorLinks = capturedMessages(EVALUATOR_EMAIL)
    } else {
      const evaluatorInbox = await adminPage.request.get(
        `/api/dev/captured?email=${EVALUATOR_EMAIL}`,
      )
      expect(evaluatorInbox.status()).toBe(200)
      recordResponse(evaluatorInbox, 'GET')
      evaluatorLinks = (await evaluatorInbox.json()) as Array<{ body: string }>
    }
    const evaluatorPath = evaluatorLinks
      .map((message) => message.body.split('Open your CFP session: ')[1]?.trim())
      .filter((path): path is string => path !== undefined)
      .at(-1)
    expect(evaluatorPath).toBeDefined()
    await evaluatorPage.goto(evaluatorPath ?? '')
    // Committee members land on the evaluations surface, not the CFP.
    await expect(evaluatorPage).toHaveURL('/evaluations')
    await expect(
      evaluatorPage.getByRole('heading', { level: 1, name: 'Evaluations' }),
    ).toBeVisible()
    await expect(evaluatorPage.getByText(TITLE)).toBeVisible()
    await evaluatorPage.getByLabel('Rating').selectOption('4')
    await evaluatorPage.getByRole('button', { name: 'Submit' }).click()
    await expect(evaluatorPage.getByText('Evaluation submitted')).toBeVisible()
    await expectNoSeriousAxeFindings(evaluatorPage, 'evaluator surface')

    // Cross-role isolation: the evaluator's cookie jar opens no admin door.
    const adminProbe = await evaluatorPage.request.get(
      `/api/admin/events/${EVENT_SLUG}/submissions`,
    )
    recordResponse(adminProbe, 'GET')
    expect([401, 403]).toContain(adminProbe.status())
    unexpectedResponses.pop() // the probe's own expected denial

    await adminPage.reload()
    await expect(adminPage.getByText(/1 of 1 scored — weighted average 4/)).toBeVisible()

    // ── Step 5b (organizer): acceptance through the real control, activated by
    //    keyboard with visible focus — the central state transition.
    enterStage('acceptance')
    await activateByKeyboard(adminPage, 'Accept proposal', {
      method: 'POST',
      pathIncludes: '/accept',
    })
    await expect(adminPage.getByText('Acceptance recorded')).toBeVisible()
    await expect(adminPage.getByText('Accepted', { exact: true })).toBeVisible()

    // Accept the conflict partner through the same UI control.
    await adminPage.goto(`/admin/events/${EVENT_SLUG}/submissions`)
    await adminPage.getByRole('link', { name: ROW_LINK(TITLE_B) }).click()
    await adminPage.getByRole('button', { name: 'Accept proposal' }).click()
    await expect(adminPage.getByText('Acceptance recorded')).toBeVisible()

    // ── Step 6 (portal): profile/bio, headshot, supporting document, and the
    //    three evidence-labeled task completions through the portal UI.
    enterStage('portal onboarding')
    await speakerPage.goto('/portal')
    await expect(
      speakerPage.getByRole('heading', { level: 1, name: 'Your submissions' }),
    ).toBeVisible()
    await expect(
      speakerPage.getByText('Requires a saved bio in “Your profile” below.'),
    ).toHaveCount(2)

    await speakerPage.getByRole('textbox', { name: 'Bio', exact: true }).fill(BIO)
    await speakerPage.getByRole('button', { name: 'Save profile' }).click()
    await expect(
      speakerPage.getByRole('region', { name: 'Your profile' }).getByText('Profile saved'),
    ).toBeVisible()

    await speakerPage.getByLabel(/upload a headshot/i).setInputFiles({
      name: 'lifecycle-headshot.png',
      mimeType: 'image/png',
      buffer: buildHeadshotPng(16),
    })
    await expect(
      speakerPage.getByRole('region', { name: 'Headshot' }).getByText('Headshot updated'),
    ).toBeVisible()

    // The file control exposes button semantics in the tree; target the
    // committed stable input id.
    await speakerPage.locator('#document-file').setInputFiles({
      name: 'lifecycle-outline.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 lifecycle outline'),
    })
    await expect(speakerPage.getByText('lifecycle-outline.pdf')).toBeVisible()

    // Evidence-gated completions on the FEATURED submission's checklist; the
    // bio task is completed by keyboard as the portal's focus evidence.
    await activateByKeyboard(speakerPage, `Mark complete: Submit your speaker bio for ${TITLE}`, {
      method: 'POST',
      pathIncludes: '/complete',
    })
    await expect(speakerPage.getByText('Submit your speaker bio marked complete')).toBeVisible()
    await speakerPage
      .getByRole('button', { name: `Mark complete: Upload your headshot for ${TITLE}` })
      .click()
    await speakerPage
      .getByRole('button', { name: `Mark complete: Confirm your participation for ${TITLE}` })
      .click()
    // Transient toasts animate during enter/exit and axe reads mid-animation
    // opacity non-deterministically; scan only after the live region settles.
    await waitForTransientToasts(speakerPage)
    await expectNoSeriousAxeFindings(speakerPage, 'speaker portal')

    // ── Step 6b (organizer): readiness reflects the same persisted evidence.
    enterStage('readiness')
    await adminPage.goto(`/admin/events/${EVENT_SLUG}/readiness`)
    await expect(adminPage.getByRole('heading', { level: 1, name: 'Readiness' })).toBeVisible()
    // The owner completed all three of their tasks; the co-speaker's three
    // are honestly still outstanding, so the row is exactly half done.
    const featuredReadinessRow = adminPage.getByRole('row', { name: new RegExp(TITLE) })
    await expect(featuredReadinessRow).toContainText('3 outstanding')
    await expect(featuredReadinessRow).toContainText('3 complete')
    await expect(featuredReadinessRow).toContainText('Not ready')

    // ── Step 7 (communications): audience, one acceptance send, one reminder,
    //    immutable typed history, and the parseable stable-UID invite.
    enterStage('communications')
    await adminPage.goto(`/admin/events/${EVENT_SLUG}/submissions/${submissionId}`)
    const audience = adminPage.getByRole('list', { name: 'Audience' })
    await expect(audience).toContainText(SPEAKER_EMAIL)
    await expect(audience).toContainText(CO_SPEAKER_EMAIL)
    await adminPage.getByRole('button', { name: 'Send acceptance' }).click()
    // Real outbound mail sits behind the confirm ladder: the trigger opens a
    // dialog and only the distinctly named confirm issues the send.
    await adminPage.getByRole('button', { name: 'Send the email' }).click()
    await expect(
      adminPage.getByRole('region', { name: 'Acceptance' }).getByText('Acceptance sent'),
    ).toBeVisible()
    await adminPage.getByRole('button', { name: 'Send reminder' }).click()
    await adminPage.getByRole('button', { name: 'Send the email' }).click()
    await expect(
      adminPage.getByRole('region', { name: 'Acceptance' }).getByText('Reminder sent'),
    ).toBeVisible()
    const history = adminPage.getByRole('list', { name: 'Send history' })
    await expect(history.getByRole('listitem')).toHaveCount(4)
    await expect(history).toContainText('Acceptance')
    await expect(history).toContainText('Reminder')
    await expect(adminPage.getByRole('button', { name: 'Send acceptance' })).toBeDisabled()

    const downloadInvite = async () => {
      const response = await speakerPage.request.get(`/api/public/invite/${submissionId}.ics`)
      recordResponse(response, 'GET')
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toBe('text/calendar; charset=utf-8')
      return response.text()
    }
    const firstCalendar = parseCalendar(await downloadInvite())
    expect(firstCalendar.properties.get('VERSION')).toBe('2.0')
    expect(firstCalendar.properties.get('SUMMARY')).toBe(TITLE)
    expect(firstCalendar.properties.get('UID')).toBe(`${submissionId}@${INVITE_UID_DOMAIN}`)
    expect(firstCalendar.properties.get('DTSTART')).toMatch(/^\d{8}T\d{6}Z$/)
    const secondCalendar = parseCalendar(await downloadInvite())
    expect(secondCalendar.properties.get('UID')).toBe(firstCalendar.properties.get('UID'))
    expect(secondCalendar.properties.get('DTSTART')).toBe(firstCalendar.properties.get('DTSTART'))

    // ── Step 8 (agenda): place both sessions into the same room and start to
    //    force the deterministic conflict, resolve it, verify all five
    //    projections, publish, and read the mobile public schedule.
    enterStage('agenda and publish')
    await adminPage.goto(`/admin/events/${EVENT_SLUG}/agenda`)
    await expect(adminPage.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

    const placementForm = (title: string) =>
      adminPage.getByRole('form', { name: `Placement for ${title}` })
    const placeSession = async (title: string, start: string) => {
      const form = placementForm(title)
      await form.getByLabel('Day').selectOption({ index: 1 })
      await form.getByLabel('Room').selectOption({ index: 1 })
      await form.getByLabel('Start').selectOption(start)
      await form.getByRole('button', { name: 'Place' }).click()
      await expect(adminPage.getByText(`Placed ${title}`)).toBeVisible()
    }
    await placeSession(TITLE, '09:00')
    await placeSession(TITLE_B, '09:00')
    // Same room+start AND the same speaker on both sessions: exactly two
    // deterministic conflicts.
    await expect(adminPage.getByText('2 conflicts to resolve.')).toBeVisible()

    // Resolve the conflict by moving the partner to a free slot.
    const partnerForm = placementForm(TITLE_B)
    await partnerForm.getByLabel('Start').selectOption('10:00')
    await partnerForm.getByRole('button', { name: 'Place' }).click()
    await expect(adminPage.getByText('No conflicts.')).toBeVisible()

    for (const view of ['List', 'Day', 'Week', 'Track', 'Room']) {
      await expect(adminPage.getByRole('region', { name: `${view} view` })).toContainText(TITLE)
    }
    await expectNoSeriousAxeFindings(adminPage, 'agenda board')

    await adminPage.getByRole('button', { name: 'Publish agenda' }).click()
    // Publication is also confirmed; the axe scan above runs with no dialog open.
    await adminPage.getByRole('button', { name: 'Publish to the programme' }).click()
    await expect(adminPage.getByText('Published 2 sessions.')).toBeVisible()

    enterStage('mobile public schedule')
    attendee = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const attendeePage = await attendee.newPage()
    attendeePage.setDefaultTimeout(15_000)
    attendeePage.setDefaultNavigationTimeout(20_000)
    attachPage(attendeePage)
    await attendeePage.goto(`/schedule/${EVENT_SLUG}`)
    await expect(attendeePage.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
    for (const view of ['List', 'Day', 'Week', 'Track', 'Room']) {
      await expect(attendeePage.getByRole('region', { name: view })).toContainText(TITLE)
    }
    // The page itself never scrolls horizontally on a phone; wide tables do.
    const bodyOverflow = await attendeePage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    )
    expect(bodyOverflow, 'no page-level horizontal scroll on mobile').toBe(true)
    await expectNoSeriousAxeFindings(attendeePage, 'mobile public schedule')

    // ── Final persisted-row evidence (bounded helper; the one direct D1 read).
    enterStage('final evidence')
    expect(countLifecycleRows()).toEqual({
      acceptances: 2,
      speakerTasks: CHECKLIST_SIZE * 3, // owner×2 submissions + co-speaker×1
      completedTasks: 3,
      headshots: 1,
      acceptanceMessages: 4, // acceptance + reminder × two recipients
    })

    // ── Mutation accounting: exact map, no unexpected write anywhere.
    const actualMutations = Object.fromEntries(mutationCounts)
    expect(
      actualMutations,
      `mutation counts must match the intended journey writes; actual=${JSON.stringify(
        actualMutations,
      )} expected=${JSON.stringify(EXPECTED_MUTATIONS)}`,
    ).toEqual(EXPECTED_MUTATIONS)
  } catch (error) {
    let adminLocation = 'admin page unavailable'
    try {
      adminLocation = `${adminPageRef?.url() ?? 'no page'} | title=${(await adminPageRef?.title()) ?? ''}`
    } catch {
      // best effort only
    }
    primaryError = new Error(
      `stage "${stage}" failed (admin at ${adminLocation}; stages: ${stageLog.join(' | ')}): ${String(error)}`,
      { cause: error },
    )
  } finally {
    // On failure, leave the contexts to the runner's teardown so the failure
    // snapshot survives; close them ourselves only on the clean path.
    if (primaryError === undefined) {
      await Promise.allSettled([
        speaker.close(),
        organizer?.close(),
        evaluator?.close(),
        attendee?.close(),
      ])
    }
  }
  if (primaryError !== undefined) {
    throw primaryError
  }
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
  expect(failedRequests).toEqual([])
  expect(unexpectedResponses).toEqual([])
})
