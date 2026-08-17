import { expect, type Locator, type Page } from '@playwright/test'

import type { TourStep } from '../../src/app/features/tour/tour-steps'

function visibleTarget(page: Page, step: TourStep): Locator {
  const target = (page.viewportSize()?.width ?? 1024) < 640 ? step.mobileTarget : step.target
  return target === null || target === undefined
    ? page.locator('main')
    : page.locator(`[data-tour="${target}"]`).first()
}

/**
 * Proves the screen behind each narration beat contains the deterministic fact
 * the beat teaches. These assertions intentionally read the page, not the coach
 * copy, so a route shell or loading placeholder cannot satisfy the tour gate.
 */
export async function expectTourSemantics(page: Page, step: TourStep): Promise<void> {
  const target = visibleTarget(page, step)

  switch (step.id) {
    case 'welcome':
      await expect(target).toContainText('Ask Orby')
      await expect(
        page.getByRole('heading', { name: 'Your event, finally in sync.' }),
      ).toBeVisible()
      await expect(page.getByText(/DemoConf 2026/).first()).toBeVisible()
      return
    case 'admin-signin':
      await expect(target.getByRole('heading', { name: 'Admin sign in' })).toBeVisible()
      await expect(target.getByLabel('Organizer secret')).toBeVisible()
      return
    case 'event-settings':
      await expect(target).toContainText('Published')
      await expect(target).toContainText('1 published form')
      await expect(target).toContainText('Open now')
      return
    case 'events':
      await expect(target).toContainText('DemoConf 2026')
      await expect(target).toContainText('demo-conf-2026')
      return
    case 'taxonomies':
      await expect
        .poll(() =>
          target
            .locator('input')
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
        )
        .toEqual(expect.arrayContaining(['AI Engineering', 'Main hall', 'Talk']))
      return
    case 'cfp-builder':
      await expect(target.getByRole('button', { name: 'Preview' })).toBeVisible()
      await expect(target.getByRole('button', { name: 'Publish' })).toBeVisible()
      await expect(target.getByRole('heading', { name: 'Conditional visibility' })).toBeVisible()
      await expect(target.getByRole('heading', { name: 'Routing' })).toBeVisible()
      await expect
        .poll(() =>
          target
            .locator('input')
            .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
        )
        .toContain('Workshop')
      return
    case 'submissions':
      await expect(target).toContainText('12 proposals from the call for papers')
      await expect(target).toContainText('Showing 12 of 12 proposals')
      return
    case 'submission-workspace':
      await expect(
        target.getByRole('heading', { name: 'The Incident Review That Changed Nothing' }),
      ).toBeVisible()
      await expect(target).toContainText('Accepted')
      await expect(target).toContainText('Version 1')
      return
    case 'speakers':
      await expect(target).toContainText('12 of 12 speaker(s) shown')
      await expect(target).toContainText('Jon Bell')
      return
    case 'messages':
      await expect(target).toContainText('[Demo fixture] Acceptance captured')
      await expect(target).toContainText('Needs attention')
      return
    case 'evaluations':
      await expect(target.getByRole('heading', { name: 'Review committee' })).toBeVisible()
      await expect(target).toContainText('Reviewer One')
      await expect(target).toContainText('Round 2: Programme balance')
      return
    case 'agenda':
      await expect(target).toContainText('8 of 9 sessions placed')
      await expect(target).toContainText('2 conflicts')
      await expect(target).toContainText('Opening keynote: Operating AI systems in public')
      await expect(target).toContainText('Invited session')
      return
    case 'embeds':
      await expect(target).toContainText('DemoConf programme')
      await expect(target.getByRole('button', { name: 'Copy iframe' })).toBeVisible()
      await expect(target.getByRole('link', { name: 'Preview' })).toBeVisible()
      return
    case 'files':
      await expect(target).toContainText('incident-review-deck.pdf')
      await expect(target).toContainText('headshot')
      await expect(target).toContainText('2 versions')
      await expect(target).toContainText('Speaker guide')
      await expect(target).toContainText('AV and slides')
      await expect(target).toContainText('Venue information')
      for (const [kind, contentType, byteLength] of [
        ['headshot', 'image/png', 68],
        ['document', 'application/pdf', 76],
      ] as const) {
        const response = await page.request.get(
          `/api/admin/events/demo-conf-2026/files/d0000000-0000-4000-8000-000000000610/${kind}`,
        )
        expect(response.status()).toBe(200)
        expect(response.headers()['content-type']).toContain(contentType)
        expect(await response.body()).toHaveLength(byteLength)
      }
      return
    case 'orby':
      await expect(target).toContainText('jon.bell@example.test')
      await expect(target).toContainText('Each room has HDMI and USB-C adapters')
      return
    case 'readiness':
      await expect(target).toContainText('25%')
      await expect(target).toContainText('5/9')
      await expect(target).toContainText('Submit headshot')
      return
    case 'palette':
      if ((page.viewportSize()?.width ?? 1024) < 640) {
        await expect(target).toContainText('Readiness')
        await expect(target).toContainText('Submit headshot')
      } else {
        await expect(target).toContainText('Search destinations')
      }
      return
    case 'public-cfp':
      await expect(target).toContainText('Step 1 of 4')
      await expect(target).toContainText('Submissions close')
      return
    case 'start':
      await expect(target.getByRole('heading', { name: 'Speaker access' })).toBeVisible()
      await expect(target.getByRole('button', { name: 'Request a link' })).toBeVisible()
      return
    case 'speaker-portal':
      await expect(target).toContainText('Confirm your participation')
      await expect(target).toContainText('Outstanding')
      await expect(target).toContainText('Upload the final presentation deck')
      await expect(target).toContainText('Opening keynote: Operating AI systems in public')
      await expect(target).toContainText('Speaker guide')
      return
    case 'speaker-files':
      await expect(target).toContainText('incident-review-deck.pdf')
      await expect(target).toContainText('v2 incident-review-deck.pdf (current)')
      await expect(target).toContainText('AV review is pending')
      return
    case 'reviewer-queue':
      await expect(target).toContainText('The Incident Review That Changed Nothing')
      await expect(target).toContainText('Programme fit (weight 3)')
      await expect(target.getByRole('button', { name: 'Save review' }).first()).toBeVisible()
      return
    case 'session-catalogue':
      await expect(target).toContainText('8 of 8 sessions shown')
      await expect(target.getByLabel('Search sessions')).toBeVisible()
      return
    case 'speaker-gallery':
      await expect(target).toContainText('8 of 8 speakers shown')
      await expect(target).toContainText('Jon Bell')
      return
    case 'schedule':
      await expect(target).toContainText('Taming 40-Minute CI')
      await expect(target).toContainText('Docs That Answer Back')
      return
    case 'itinerary':
      await expect(target).toHaveAccessibleName('Add to my schedule')
      await expect(page.locator('main')).toContainText('0 sessions saved on this device')
      await expect(page.locator('main')).toContainText(
        'Add a session to My schedule before exporting a calendar',
      )
      await expect(page.getByRole('link', { name: 'Add to Google Calendar' }).first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'Add to Outlook' }).first()).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'Download iCalendar file' }).first(),
      ).toBeVisible()
      return
  }

  throw new Error(`Missing semantic tour assertion for '${step.id}'`)
}
