import { Link } from '@tanstack/react-router'

import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'
import { publicDestinations, speakerDestinations } from '../nav/nav-model'

const LINK_CLASS =
  'min-h-6 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground aria-[current=page]:underline'

/**
 * Two landmarks, not one. "Your speaker portal" and "Your headshot" belong to
 * the speaker; the call for papers, the public schedule and the evaluator
 * surface belong to anyone. The public shell renders this on /evaluations too,
 * where telling a reviewer that the speaker portal is theirs would be wrong.
 *
 * The programme links are what make the public CFP and schedule reachable
 * without typing a URL.
 */
export default function SpeakerNav() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <nav aria-label="Speaker" className="flex flex-wrap items-center gap-4">
        {speakerDestinations().map((destination) => (
          <Link
            key={destination.id}
            to={destination.to}
            activeProps={{ 'aria-current': 'page' }}
            className={LINK_CLASS}
          >
            {destination.label}
          </Link>
        ))}
      </nav>
      <nav aria-label="Programme" className="flex flex-wrap items-center gap-4">
        {publicDestinations(DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG).map((destination) => (
          <Link
            key={destination.id}
            to={destination.to}
            params={destination.params}
            activeProps={{ 'aria-current': 'page' }}
            className={LINK_CLASS}
          >
            {destination.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
