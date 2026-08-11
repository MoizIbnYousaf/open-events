import type { ReactElement, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { Kbd } from '../../../components/ui/kbd'
import { organizerDestinations, type NavDestination } from './nav-model'
import { NAV_ROW_CLASS } from './nav-row'

/**
 * The organizer workspace shell: a 240px left rail on wide viewports that folds
 * into a wrapping pill bar on narrow ones. It renders the same `nav-model`
 * destinations the command palette offers, grouped under their nav-model group
 * headings, so the two surfaces can never drift apart.
 *
 * One `nav` landmark, responsive by CSS only: rendering a second compact nav
 * for small screens would put two navigations named "Event" in the tree and
 * break both assistive tech and any `getByRole('navigation')` query. The fold
 * is a `display: contents` swap, so no row is ever unmounted and there is no
 * breakpoint flash on first paint.
 *
 * At `lg` the rail is pinned against the toolbar and scrolls independently of
 * the page, with `overscroll-contain` so a flick in a long destination list
 * never chains out into the content column.
 *
 * Icons are small inline SVGs on purpose: this component is reached by the
 * entry chunk, which `scripts/perf-check.mjs` holds to a gzip budget and greps
 * for third-party icon-library names. They are original drawings on the same
 * 24 grid / 1.5 stroke as `components/ui/icons.tsx`, thickened to 1.75 at the
 * 16px render size by that module's optical-compensation rule.
 *
 * `components/ui/icons.tsx` remains the icon system of record: its geometry
 * rules (24 viewBox, round caps, size-compensated stroke) and its aria-hidden
 * default are what these six glyphs conform to, and a change there is a change
 * these must follow. What does NOT follow is the artwork — the rail cannot
 * import that module without pulling it into the entry chunk, so re-sourcing a
 * nav glyph means editing this switch by hand. That duplication is the price of
 * the purity rule, and it is paid knowingly here rather than discovered later.
 * These drawings are first-party (declared in `scripts/notices-check.mjs`);
 * pasting donor path data in here needs a THIRD_PARTY_NOTICES.md row and the
 * provenance gate will say so.
 */

/* The shared row recipe plus the group name the icon's colour promotion hangs
   off, so hovering anywhere on the row lights the glyph too. */
const RAIL_LINK_CLASS = 'group/rail ' + NAV_ROW_CLASS

const GROUP_ORDER: readonly string[] = ['Event', 'Programme']

/** The organizer content column's landmark id, used by the in-shell skip link. */
const CONTENT_ID = 'content'

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

function DestinationIcon({ id }: { readonly id: string }): ReactElement {
  switch (id) {
    /* Sliders: the event's own settings, not the workspace at large. */
    case 'event-settings':
      return (
        <svg {...ICON_PROPS}>
          <path d="M4 7.5h5m3 0h8M4 16.5h9m3 0h4" />
          <path d="M10.5 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM14.5 14.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
        </svg>
      )
    /* A tag: tracks, rooms and formats are labels the rest of the app reuses. */
    case 'taxonomies':
      return (
        <svg {...ICON_PROPS}>
          <path d="M11.2 3.5H4.5a1 1 0 0 0-1 1v6.7a2 2 0 0 0 .6 1.4l7.3 7.3a2 2 0 0 0 2.8 0l6.1-6.1a2 2 0 0 0 0-2.8l-7.3-7.3a2 2 0 0 0-1.4-.6Z" />
          <path d="M7.6 7.6h.01" />
        </svg>
      )
    /* A proposal document with a turned corner. */
    case 'submissions':
      return (
        <svg {...ICON_PROPS}>
          <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8L13.5 3Z" />
          <path d="M13.5 3v3.5A1.5 1.5 0 0 0 15 8h3.5" />
          <path d="M9 13h6M9 16.5h4" />
        </svg>
      )
    /* A checklist: what each speaker still owes. */
    case 'readiness':
      return (
        <svg {...ICON_PROPS}>
          <path d="M11 6h8M11 12h8M11 18h8" />
          <path d="m4 5.4 1.4 1.4L8.2 4M4 11.4l1.4 1.4L8.2 10M4 17.4l1.4 1.4L8.2 16" />
        </svg>
      )
    /* A rating star: the committee scores proposals here. */
    case 'evaluations':
      return (
        <svg {...ICON_PROPS}>
          <path d="m12 3.6 2.55 5.4 5.7.85-4.13 4.15 1 5.9L12 17.1l-5.12 2.8 1-5.9L3.75 9.85l5.7-.85L12 3.6Z" />
        </svg>
      )
    /* A calendar grid: sessions placed onto days, tracks and rooms. */
    case 'agenda':
      return (
        <svg {...ICON_PROPS}>
          <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z" />
          <path d="M8 3v5M16 3v5M3.5 10.5h17" />
        </svg>
      )
    case 'orby':
      return (
        <svg {...ICON_PROPS}>
          <path d="M5 6.5h14A1.5 1.5 0 0 1 20.5 8v7.5A1.5 1.5 0 0 1 19 17h-4l-4 3.5V17H5A1.5 1.5 0 0 1 3.5 15.5V8A1.5 1.5 0 0 1 5 6.5Z" />
        </svg>
      )
    default:
      return (
        <svg {...ICON_PROPS}>
          <path d="M12 9.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
        </svg>
      )
  }
}

function RailLink({ destination }: { readonly destination: NavDestination }): ReactElement {
  return (
    <Link
      to={destination.to}
      params={destination.params}
      activeOptions={{ exact: true }}
      activeProps={{ 'aria-current': 'page' }}
      className={RAIL_LINK_CLASS}
      data-tour={'rail-' + destination.id}
    >
      {/* One step below the label at rest, promoted to the label's own colour
          when the row is hovered or current — the row reads as one object. */}
      <span className="flex w-4 shrink-0 justify-center text-muted-foreground transition-colors group-hover/rail:text-current group-aria-[current=page]/rail:text-current">
        <DestinationIcon id={destination.id} />
      </span>
      <span className="min-w-0 truncate">{destination.label}</span>
    </Link>
  )
}

export interface AppShellProps {
  readonly slug: string
  readonly children: ReactNode
}

export default function AppShell({ slug, children }: AppShellProps): ReactElement {
  const destinations = organizerDestinations(slug)
  return (
    /* `shrink-0` is what makes the rail stick.
       This grid is a flex item of the `#main` scroller, and `min-h-full`
       resolves to the scrollport's height. Without `shrink-0`, flex shrinking
       clamped the grid's BOX to exactly that height while its row ran on to the
       full page — and a sticky child whose containing block is no taller than
       itself has nowhere to move, so it scrolled away with the content on every
       organizer route. Letting the box grow to its row is the whole fix; the
       sticky declaration below was always right. */
    <div className="grid min-h-full shrink-0 lg:grid-cols-[var(--rail-width)_minmax(0,1fr)]">
      {/* The rail is a column, not the nav itself: the identity row and the
          footer hint are chrome around the destinations, and folding them into
          the landmark would put them inside the navigation a screen reader
          announces.

          The height subtracts the toolbar AND its hairline. The frame is
          exactly `100svh` and the header is `--navbar-height` plus a 1px
          bottom border, so the scrollport is one pixel shorter than the
          obvious arithmetic — and a sticky box one pixel taller than its
          scrollport can never satisfy `top: 0`, which cost the rail its last
          row and its footer. */}
      <div className="relative flex flex-col border-b border-border bg-sidebar lg:sticky lg:top-0 lg:h-[calc(100svh-var(--navbar-height)-1px)] lg:border-r lg:border-b-0">
        {/* The site skip link lands on `#main`, and this whole rail lives
            inside `#main` — so "skip to content" left the reader at the top of
            six destination links, which is the block they asked to skip. The
            bypass belongs where the block starts: first child of the rail,
            invisible until focused, pointing past the navigation at the
            content column. */}
        <a
          href={'#' + CONTENT_ID}
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-40 focus:rounded-md focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-popover focus:outline-hidden focus:ring-2 focus:ring-ring"
        >
          Skip navigation
        </a>
        <div className="hidden items-center gap-2 border-b border-border px-3 py-2.5 lg:flex">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground/[0.06] text-[10px] font-semibold text-muted-foreground uppercase"
          >
            {slug.slice(0, 1)}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{slug}</span>
        </div>
        <nav
          aria-label="Event"
          className="flex flex-wrap content-start gap-0.5 p-2 lg:min-h-0 lg:flex-1 lg:flex-col lg:flex-nowrap lg:gap-0 lg:overflow-y-auto lg:overscroll-contain"
        >
          {GROUP_ORDER.map((group, index) => (
            <div key={group} className="contents lg:grid lg:gap-px">
              <div
                className={
                  'hidden px-2 pb-1 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase lg:block ' +
                  (index === 0 ? 'pt-1' : 'pt-4')
                }
              >
                {group}
              </div>
              {destinations.flatMap((destination) =>
                destination.group === group ? (
                  <RailLink key={destination.id} destination={destination} />
                ) : (
                  []
                ),
              )}
            </div>
          ))}
        </nav>
        {/* The palette is the rail's accelerator, so the rail is where its
            shortcut is published. Static text, not a second control: the
            toolbar already owns the visible button. */}
        <p className="hidden items-center gap-1.5 border-t border-border px-3 py-2.5 text-xs text-muted-foreground lg:flex">
          <Kbd>⌘K</Kbd>
          to search
        </p>
      </div>
      {/* `tabIndex={-1}` so the skip link can actually put focus here; without
          it the browser moves the scroll position and leaves focus behind. */}
      <div id={CONTENT_ID} tabIndex={-1} className="min-w-0 px-4 py-4 outline-none lg:px-6 lg:py-6">
        {children}
      </div>
    </div>
  )
}
