import { expect, test } from '@playwright/test'

import { TOUR_STEPS } from '../src/app/features/tour/tour-steps'
import { isConsoleNoise } from './helpers/console-noise'

function concretePath(route: string, params?: Readonly<Record<string, string>>): string {
  return route.replace(/\$([A-Za-z0-9_]+)/g, (segment, name: string) => params?.[name] ?? segment)
}

test('a cold visitor completes every guided-tour step without credentials or denied admin pages', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedResponses: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !isConsoleNoise(message.text())) {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const url = new URL(response.url())
      failedResponses.push(`${response.status()} ${url.pathname}${url.search}`)
    }
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Take the tour', exact: true }).click()
  const dialog = page.getByRole('dialog')

  for (const [index, step] of TOUR_STEPS.entries()) {
    await expect(dialog).toBeVisible()
    await expect(page.locator('main')).toBeVisible()
    await expect(dialog).toHaveAccessibleName(step.title)
    await expect(dialog.getByRole('status').first()).toContainText(
      `Step ${index + 1} of ${TOUR_STEPS.length}`,
    )

    if (step.route !== undefined) {
      await expect(page).toHaveURL(
        new RegExp(`${concretePath(step.route, step.params).replaceAll('/', '\\/')}(?:[?#]|$)`),
      )
    }
    if (step.target !== undefined) {
      await expect(page.locator(`[data-tour="${step.target}"]`).first()).toBeVisible()
    }
    if (step.access === 'organizer' && step.requiresSession === 'organizer') {
      await expect(page.getByRole('heading', { name: 'Access forbidden' })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Your session has expired' })).toHaveCount(0)
    }
    if (step.access === 'portal' || step.access === 'evaluation') {
      await expect(page.getByRole('heading', { name: /access.*(needed|required)/i })).toHaveCount(0)
      await expect(page.getByText(/organizer-issued link/i)).toHaveCount(0)
    }

    const finalStep = index === TOUR_STEPS.length - 1
    await dialog.getByRole('button', { name: finalStep ? 'Done' : 'Next', exact: true }).click()
  }

  await expect(dialog).toHaveCount(0)
  const adminAfterTour = await page.request.get('/api/admin/events/demo-conf-2026')
  expect(adminAfterTour.status()).toBe(401)
  // The builder uses a missing draft as the signal that its current published
  // version is immutable. It is an optional-resource response, not a broken
  // tour screen; every visible state above is still required to render.
  expect(failedResponses).toEqual([
    '404 /api/admin/events/demo-conf-2026/forms/f0000000-0000-4000-8000-000000000001/draft',
    '404 /api/public/profile/headshot',
    '404 /api/public/profile/document',
  ])
  expect(consoleErrors).toEqual([
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
  ])
  expect(pageErrors).toEqual([])
})

test('a visitor can pause, leave, and resume the exact tour step', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Take the tour', exact: true }).click()
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
