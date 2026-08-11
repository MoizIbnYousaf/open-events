import { useEffect } from 'react'

import StartForm from './StartForm'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'

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
  // The tab kept whatever title the previous route had left there, so a
  // speaker with several tabs open could not tell which one held the sign-in
  // step (WCAG 2.4.2).
  useEffect(() => {
    document.title = 'Start — Open Events'
  }, [])

  return (
    <div className="mx-auto w-full max-w-md">
      <StartForm eventSlug={DEFAULT_EVENT_SLUG} formSlug={DEFAULT_FORM_SLUG} />
    </div>
  )
}
