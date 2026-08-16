import { useEffect } from 'react'

import StartForm from './StartForm'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'
import { AlertLive } from '../../../components/ui/alert-live'
import { Card, CardDescription, CardHeader } from '../../../components/ui/card'
import { PageHeaderTitle } from '../../../components/ui/page-header'

type AccessRecovery = 'cfp' | 'portal' | 'evaluation' | 'legacy' | 'invalid'

function accessRecovery(): AccessRecovery | null {
  const value = new URL(window.location.href).searchParams.get('access')
  return value === 'cfp' ||
    value === 'portal' ||
    value === 'evaluation' ||
    value === 'legacy' ||
    value === 'invalid'
    ? value
    : null
}

/**
 * The seeded DemoConf 2026 pair used to be copy-pasted here, which let this
 * screen drift away from the slug every other surface links to. It now reads
 * the one shared constant, so the sign-in step and the call for papers it
 * belongs to can never point at different events.
 *
 * Single-purpose page, so the column is narrower than the public measure: one
 * field and one button read better in a short line than stretched across the
 * full reading width.
 */
export function PublicStartPage() {
  const recovery = accessRecovery()
  // The tab kept whatever title the previous route had left there, so a
  // speaker with several tabs open could not tell which one held the sign-in
  // step (WCAG 2.4.2).
  useEffect(() => {
    document.title = 'Start — Open Events'
  }, [])

  if (recovery === 'evaluation' || recovery === 'portal') {
    return (
      <div className="mx-auto w-full max-w-md">
        <Card className="py-4">
          <CardHeader>
            <PageHeaderTitle>
              {recovery === 'evaluation' ? 'Reviewer link expired' : 'Speaker portal link expired'}
            </PageHeaderTitle>
            <CardDescription>
              {recovery === 'evaluation'
                ? 'Ask the event organizer to issue a fresh reviewer invitation. Proposal links do not open the review queue.'
                : 'Ask the event organizer to issue a fresh speaker portal invitation. The public proposal form cannot restore portal access.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const recoveryCopy =
    recovery === 'cfp'
      ? 'That proposal link is expired or already used. Request a fresh proposal link below.'
      : recovery === 'legacy'
        ? 'That older link no longer identifies its role. Speakers can request a proposal link below; reviewers must ask the event organizer for a fresh invitation.'
        : recovery === 'invalid'
          ? 'That link is invalid. Speakers can request a proposal link below; reviewers must ask the event organizer for a fresh invitation.'
          : null

  return (
    <div className="mx-auto w-full max-w-md">
      {recoveryCopy === null ? null : <AlertLive>{recoveryCopy}</AlertLive>}
      <StartForm eventSlug={DEFAULT_EVENT_SLUG} formSlug={DEFAULT_FORM_SLUG} />
    </div>
  )
}
