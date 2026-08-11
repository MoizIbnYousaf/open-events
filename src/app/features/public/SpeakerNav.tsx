import { Link } from '@tanstack/react-router'

import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'
import { publicDestinations, speakerDestinations } from '../nav/nav-model'
import { NAV_ROW_CLASS } from '../nav/nav-row'

/**
 * Two landmarks, not one. "Your speaker portal" and "Your headshot" belong to
 * the speaker; the call for papers, the public schedule and the evaluator
 * surface belong to anyone. The public shell renders this on /evaluations too,
 * where telling a reviewer that the speaker portal is theirs would be wrong.
 *
 * The programme links are what make the public CFP and schedule reachable
 * without typing a URL.
 *
 * Styled as the same 30px navigation rows the organizer rail uses, laid out
 * horizontally: a public page has no room for a rail, but "where I am" should
 * look the same wherever the reader meets it. The two landmarks read as two
 * clusters — 1px between rows inside a landmark, a hairline and a wide gap
 * between them — so the split is visible and not only announced. Below `sm`
 * the whole strip wraps rather than scrolling sideways.
 */
export default function SpeakerNav() {
  return (
    // `-mx-2` cancels the nav rows' own `px-2` so the first pill's TEXT
    // starts on the content column's edge, not 8px inside it. Without it the
    // nav sat 8px right of the h1 beneath it on every public route.
    <div className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <nav aria-label="Speaker" className="flex min-w-0 flex-wrap items-center gap-px">
        {speakerDestinations().map((destination) => (
          <Link
            key={destination.id}
            to={destination.to}
            activeProps={{ 'aria-current': 'page' }}
            className={NAV_ROW_CLASS}
          >
            {destination.label}
          </Link>
        ))}
      </nav>
      <span aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-border sm:block" />
      <nav aria-label="Programme" className="flex min-w-0 flex-wrap items-center gap-px">
        {publicDestinations(DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG).map((destination) => (
          <Link
            key={destination.id}
            to={destination.to}
            params={destination.params}
            activeProps={{ 'aria-current': 'page' }}
            className={NAV_ROW_CLASS}
          >
            {destination.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
