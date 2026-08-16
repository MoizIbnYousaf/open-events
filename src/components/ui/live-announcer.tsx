import { useSyncExternalStore } from 'react'

import { getAnnouncementSnapshot, subscribeToAnnouncements } from '../../app/lib/announcer'

/**
 * The app's two permanent live regions, rendered once in the root shell and
 * never unmounted. This product answers
 * transient feedback with inline, durable messages plus these regions, not
 * with a toast overlay — every action here changes the surface the operator is
 * already looking at, and the error recoveries carry buttons that must not
 * auto-dismiss.
 *
 * The regions declare aria-live/aria-atomic and deliberately carry NO ARIA
 * role. role="status" would be behaviourally identical for assistive tech but
 * would add a second, page-global status node under every surface's own
 * `getByRole('status')`, making the app's per-surface status messages
 * ambiguous both to tests and to anything else that enumerates them.
 *
 * The keyed inner span is what makes an identical repeated message announce
 * again: React replaces the node instead of leaving the text untouched.
 */
export function LiveAnnouncer() {
  const announcement = useSyncExternalStore(
    subscribeToAnnouncements,
    getAnnouncementSnapshot,
    getAnnouncementSnapshot,
  )
  const polite = announcement.politeness === 'polite' ? announcement.message : ''
  const assertive = announcement.politeness === 'assertive' ? announcement.message : ''

  return (
    <div className="sr-only">
      <div aria-live="polite" aria-atomic="true">
        {polite === '' ? null : <span key={announcement.seq}>{polite}</span>}
      </div>
      <div aria-live="assertive" aria-atomic="true">
        {assertive === '' ? null : <span key={announcement.seq}>{assertive}</span>}
      </div>
    </div>
  )
}
