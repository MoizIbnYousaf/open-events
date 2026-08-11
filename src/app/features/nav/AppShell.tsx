import type { ReactElement, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { organizerDestinations, type NavDestination } from './nav-model'

/**
 * The organizer workspace shell: a left rail on wide viewports that folds into
 * a wrapping pill bar on narrow ones. It renders the same `nav-model`
 * destinations the command palette offers, grouped under their nav-model
 * group headings, so the two surfaces can never drift apart.
 *
 * One `nav` landmark, responsive by CSS only: rendering a second compact nav
 * for small screens would put two navigations named "Event" in the tree and
 * break both assistive tech and any `getByRole('navigation')` query.
 *
 * Icons are small inline SVGs on purpose: the admin route chunks are covered
 * by per-route perf budgets, so an icon library would spend budget on
 * decoration.
 */

const RAIL_LINK_CLASS =
  'flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm text-foreground outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:font-medium'

const GROUP_ORDER: readonly string[] = ['Event', 'Programme']

const ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

function DestinationIcon({ id }: { readonly id: string }): ReactElement {
  switch (id) {
    case 'event-settings':
      return (
        <svg {...ICON_PROPS}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2" />
        </svg>
      )
    case 'taxonomies':
      return (
        <svg {...ICON_PROPS}>
          <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      )
    case 'submissions':
      return (
        <svg {...ICON_PROPS}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      )
    case 'readiness':
      return (
        <svg {...ICON_PROPS}>
          <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
          <path d="m9 11 3 3L22 4" />
        </svg>
      )
    case 'evaluations':
      return (
        <svg {...ICON_PROPS}>
          <path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
        </svg>
      )
    case 'agenda':
      return (
        <svg {...ICON_PROPS}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M8 2v4M16 2v4M3 10h18" />
        </svg>
      )
    default:
      return (
        <svg {...ICON_PROPS}>
          <circle cx="12" cy="12" r="2" />
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
      <span className="flex w-4 shrink-0 justify-center text-muted-foreground">
        <DestinationIcon id={destination.id} />
      </span>
      {destination.label}
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
    <div className="grid min-h-full lg:grid-cols-[220px_1fr]">
      <nav
        aria-label="Event"
        className="flex flex-wrap content-start gap-0.5 border-b bg-sidebar p-3 lg:grid lg:border-r lg:border-b-0"
      >
        <div className="hidden w-full px-2 pt-1 pb-3 lg:block">
          <div className="truncate text-sm font-medium">{slug}</div>
        </div>
        {GROUP_ORDER.map((group) => (
          <div key={group} className="contents lg:grid lg:gap-0.5">
            <div className="hidden px-2 pt-3 pb-1.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase lg:block">
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
      <div className="min-w-0 px-4 py-6 lg:px-7">{children}</div>
    </div>
  )
}
