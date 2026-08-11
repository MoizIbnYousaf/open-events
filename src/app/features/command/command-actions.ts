/**
 * What the command menu can do, as data.
 *
 * Navigation entries are read from `src/app/features/nav/nav-model.ts` — the
 * same list the visible navigation renders — so the palette can never offer a
 * destination the visible UI does not have, and a route that is deliberately
 * unlinked (DEC-016) stays unlinked here too. There is no second list to keep
 * in step.
 *
 * Pure TypeScript: no JSX, no router, no React, so the model is unit testable
 * on its own.
 */

import { THEME_LABELS, THEME_PREFERENCES, type ThemePreference } from '../../../lib/theme'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../lib/default-event'
import {
  organizerDestinations,
  publicDestinations,
  speakerDestinations,
  type NavGroup,
} from '../nav/nav-model'

export type CommandGroupName = NavGroup | 'Theme'

export interface NavigateCommand {
  readonly kind: 'navigate'
  readonly id: string
  readonly label: string
  readonly group: CommandGroupName
  readonly to: string
  readonly params?: Readonly<Record<string, string>>
}

export interface ThemeCommand {
  readonly kind: 'theme'
  readonly id: string
  readonly label: string
  readonly group: 'Theme'
  readonly preference: ThemePreference
}

export type CommandAction = NavigateCommand | ThemeCommand

/** Rendering order; every action belongs to exactly one of these. */
const GROUP_ORDER: readonly CommandGroupName[] = [
  'Event',
  'Programme',
  'Public',
  'Speaker',
  'Theme',
]

export function commandActions(): readonly CommandAction[] {
  const destinations = [
    ...organizerDestinations(DEFAULT_EVENT_SLUG),
    ...speakerDestinations(),
    ...publicDestinations(DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG),
  ]
  const navigate: readonly CommandAction[] = destinations.map((destination) => ({
    kind: 'navigate',
    id: destination.id,
    label: destination.label,
    group: destination.group,
    to: destination.to,
    ...(destination.params === undefined ? {} : { params: destination.params }),
  }))
  const theme: readonly CommandAction[] = THEME_PREFERENCES.map((preference) => ({
    kind: 'theme',
    id: `theme-${preference}`,
    label: THEME_LABELS[preference],
    group: 'Theme',
    preference,
  }))
  return [...navigate, ...theme]
}

/**
 * Every whitespace-separated term has to appear somewhere in the label or the
 * group, so "public sched" finds the public schedule and a typo finds nothing
 * rather than everything.
 */
export function filterCommandActions(
  actions: readonly CommandAction[],
  query: string,
): readonly CommandAction[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return actions
  return actions.filter((action) => {
    const haystack = `${action.label} ${action.group}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export interface CommandGroupModel {
  readonly heading: CommandGroupName
  readonly items: readonly CommandAction[]
}

/** Groups in a fixed order; empty groups are dropped rather than rendered bare. */
export function groupCommandActions(
  actions: readonly CommandAction[],
): readonly CommandGroupModel[] {
  return GROUP_ORDER.map((heading) => ({
    heading,
    items: actions.filter((action) => action.group === heading),
  })).filter((group) => group.items.length > 0)
}
