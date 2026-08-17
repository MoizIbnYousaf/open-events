import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { TOUR_STEPS } from '../src/app/features/tour/tour-steps'
import { observeTour } from './helpers/tour-observer'
import { expectTourSemantics } from './helpers/tour-semantics'

function concretePath(route: string, params?: Readonly<Record<string, string>>): string {
  return route.replace(/\$([A-Za-z0-9_]+)/g, (segment, name: string) => params?.[name] ?? segment)
}

const AXE_MOMENTS = new Set([
  'welcome',
  'submissions',
  'speaker-portal',
  'reviewer-queue',
  'itinerary',
])

async function expectNoSeriousAxeFindings(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const severe = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )
  expect(
    severe.map(
      (violation) => `${label}: ${violation.id} at ${violation.nodes[0]?.target.join(' ')}`,
    ),
    `axe on ${label}`,
  ).toEqual([])
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop-reduced-motion') {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  }
  if (testInfo.project.name === 'desktop-zoom-200') {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
  }
})

test('a cold visitor completes every guided-tour step without credentials or denied admin pages', async ({
  page,
}, testInfo) => {
  const observer = observeTour(page)

  await page.goto('/')
  await page.getByRole('banner').getByRole('button', { name: 'Take the tour', exact: true }).click()
  const dialog = page.getByRole('dialog')

  for (const [index, step] of TOUR_STEPS.entries()) {
    await expect(dialog).toBeVisible()
    await expect(page.locator('main')).toBeVisible()
    await expect(dialog).toHaveAccessibleName(step.title)
    if (testInfo.project.name === 'desktop-reduced-motion') {
      const motion = await dialog.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          animationName: style.animationName,
          transitionDuration: style.transitionDuration,
        }
      })
      expect(motion).toEqual({ animationName: 'none', transitionDuration: '0s' })
    }
    await expect(dialog.getByRole('status').first()).toContainText(
      `Step ${index + 1} of ${TOUR_STEPS.length}`,
    )
    const viewport = await page.evaluate(() => ({
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
    }))
    const dialogBox = await dialog.boundingBox()
    const dialogGeometry = await dialog.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        maxHeight: style.maxHeight,
        boxSizing: style.boxSizing,
        overflowY: style.overflowY,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }
    })
    expect(dialogBox).not.toBeNull()
    if (dialogBox !== null) {
      expect(dialogBox.x).toBeGreaterThanOrEqual(0)
      expect(dialogBox.y).toBeGreaterThanOrEqual(0)
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width)
      expect(
        dialogBox.y + dialogBox.height,
        `${step.id}: ${JSON.stringify(dialogGeometry)}`,
      ).toBeLessThanOrEqual(viewport.height)
    }

    if (step.route !== undefined) {
      await expect(page).toHaveURL(
        new RegExp(`${concretePath(step.route, step.params).replaceAll('/', '\\/')}(?:[?#]|$)`),
      )
    }
    const target = (page.viewportSize()?.width ?? 1024) < 640 ? step.mobileTarget : step.target
    if (target !== null && target !== undefined) {
      await expect(page.locator(`[data-tour="${target}"]`).first()).toBeVisible()
    }
    await expectTourSemantics(page, step)
    if (AXE_MOMENTS.has(step.id)) await expectNoSeriousAxeFindings(page, step.id)
    if (step.access === 'organizer' && step.requiresSession === 'organizer') {
      await expect(page.getByRole('heading', { name: 'Access forbidden' })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Your session has expired' })).toHaveCount(0)
    }
    if (step.access === 'portal' || step.access === 'evaluation') {
      await expect(page.getByRole('heading', { name: /access.*(needed|required)/i })).toHaveCount(0)
      await expect(page.getByText(/organizer-issued link/i)).toHaveCount(0)
    }

    const finalStep = index === TOUR_STEPS.length - 1
    const forward = dialog.getByRole('button', {
      name: finalStep ? 'Done' : 'Next',
      exact: true,
    })
    const hit = await forward.evaluate((button) => {
      const bounds = button.getBoundingClientRect()
      const target = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      )
      return {
        contains: target !== null && button.contains(target),
        button: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height },
        target: target?.tagName ?? null,
        targetClass: target instanceof HTMLElement ? target.className : null,
      }
    })
    expect(hit.contains, `${step.id}: ${JSON.stringify(hit)}`).toBe(true)
    await forward.evaluate((button) => (button as HTMLButtonElement).click())
  }

  await expect(dialog).toHaveAccessibleName(/one proposal, ready for an audience/i)
  await dialog.getByRole('button', { name: 'Explore DemoConf' }).click()
  await expect(dialog).toHaveCount(0)
  const adminAfterTour = await page.request.get('/api/admin/events/demo-conf-2026')
  expect(adminAfterTour.status()).toBe(401)
  expect(observer.accessStarts()).toBe(3)
  observer.assertClean()
})

test('the complete tour advances through keyboard activation alone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'single canonical keyboard matrix')

  await page.goto('/')
  const start = page.getByRole('banner').getByRole('button', { name: 'Take the tour', exact: true })
  await start.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')

  for (const [index, step] of TOUR_STEPS.entries()) {
    await expect(dialog).toHaveAccessibleName(step.title)
    await expectTourSemantics(page, step)
    const forward = dialog.getByRole('button', {
      name: index === TOUR_STEPS.length - 1 ? 'Done' : 'Next',
      exact: true,
    })
    await forward.focus()
    await expect(forward).toBeFocused()
    await page.keyboard.press('Enter')
  }

  await expect(dialog).toHaveAccessibleName(/one proposal, ready for an audience/i)
  await dialog.getByRole('button', { name: 'Explore DemoConf' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
})

test('a visitor can pause, leave, and resume the exact tour step', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('banner').getByRole('button', { name: 'Take the tour', exact: true }).click()
  const dialog = page.getByRole('dialog')

  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Event overview')
  await expect(dialog.getByRole('status').first()).toContainText(`Step 3 of ${TOUR_STEPS.length}`)

  await dialog.getByRole('button', { name: 'Pause tour', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Resume tour', exact: true })).toBeVisible()
  expect((await page.request.get('/api/admin/events/demo-conf-2026')).status()).toBe(401)

  await page.reload()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Resume tour', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Event overview')
  await expect(dialog.getByRole('status').first()).toContainText(`Step 3 of ${TOUR_STEPS.length}`)
  await expect(page.locator('[data-tour="rail-event-settings"]').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Access forbidden' })).toHaveCount(0)
})

test('an attendee can save an itinerary and fetch its iCalendar export', async ({ page }) => {
  await page.goto('/schedule/demo-conf-2026')
  await page.getByRole('button', { name: 'Add to my schedule' }).first().click()

  await expect(page.getByText('1 session saved on this device.')).toBeVisible()
  const calendar = page.getByRole('link', { name: 'Add my schedule to calendar' })
  await expect(calendar).toBeVisible()
  const href = await calendar.getAttribute('href')
  expect(href).toMatch(/^\/api\/public\/events\/demo-conf-2026\/schedule\.ics\?ids=/)

  const response = await page.request.get(href ?? '')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/calendar')
  expect(await response.text()).toContain('BEGIN:VCALENDAR')
})

test('browser history divergence pauses the tour and revokes its role', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'single canonical history matrix')

  await page.goto('/')
  await page.getByRole('banner').getByRole('button', { name: 'Take the tour', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.goBack()

  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Resume tour' })).toBeVisible()
  expect((await page.request.get('/api/admin/events/demo-conf-2026')).status()).toBe(401)
})
