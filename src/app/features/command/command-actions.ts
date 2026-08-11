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

/** A matched action, carrying the label indices that earned the match. */
export type ScoredCommandAction = CommandAction & { readonly matched: readonly number[] }

/** Nothing matched anything: shared so an unfiltered list allocates one array. */
const NO_MATCH: readonly number[] = []

/**
 * A query cannot pull in more rows than this. The action list is thirteen rows
 * today, so the cap only matters once route-scoped rows exist — which is
 * exactly when an unbounded list would start scrolling past the fold.
 */
const MAX_RESULTS = 30

/**
 * Adapted from cloudflare-os (Apache-2.0) — see THIRD_PARTY_NOTICES.md.
 *
 * A dependency-free subsequence matcher. It returns the matched character
 * positions along with a relevance score, or null when the query is not a
 * subsequence of the text at all, so filtering and ranking happen in one pass.
 *
 * The bonuses are what make it feel like a search rather than a regex: a run
 * of adjacent characters is worth much more than the same characters scattered
 * about, a match that starts a word is worth more again, and a match that
 * starts earlier in the string wins a tie. "pub sch" therefore ranks the
 * public schedule above anything that merely contains those letters.
 *
 * `query` must already be lower-cased; `text` is folded here.
 */
function fuzzyMatch(
  text: string,
  query: string,
): { readonly score: number; readonly indices: readonly number[] } | null {
  const haystack = text.toLowerCase()
  const indices: number[] = []
  let score = 0
  let run = 0
  let previous = -2
  let from = 0
  for (const character of query) {
    const found = haystack.indexOf(character, from)
    if (found === -1) return null
    indices.push(found)
    if (found === previous + 1) {
      run += 1
      score += 5 + run
    } else {
      run = 0
      score += 1
    }
    if (found === 0 || /[\s\-_/]/.test(haystack[found - 1] ?? '')) score += 10
    previous = found
    from = found + 1
  }
  return { score: score - (indices[0] ?? 0), indices }
}

/**
 * Every whitespace-separated term has to match, so "public sched" finds the
 * public schedule and a typo finds nothing rather than everything. A term
 * matches the row's label, or failing that its group — asking for "programme"
 * is a real way to ask for a set of screens — but a group match scores half,
 * because the words the reader is looking at are the ones in the label.
 *
 * Rows come back ordered by score. `groupCommandActions` keeps the group order
 * fixed, so the ranking only ever reorders rows within a heading.
 */
export function filterCommandActions(
  actions: readonly CommandAction[],
  query: string,
): readonly ScoredCommandAction[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return actions.map((action) => ({ ...action, matched: NO_MATCH }))
  const scored: { readonly action: CommandAction; readonly matched: number[]; score: number }[] = []
  for (const action of actions) {
    const matched = new Set<number>()
    let score = 0
    let survives = true
    for (const term of terms) {
      const onLabel = fuzzyMatch(action.label, term)
      if (onLabel !== null) {
        score += onLabel.score
        for (const index of onLabel.indices) matched.add(index)
        continue
      }
      const onGroup = fuzzyMatch(action.group, term)
      if (onGroup === null) {
        survives = false
        break
      }
      score += onGroup.score / 2
    }
    if (!survives) continue
    scored.push({ action, matched: [...matched].sort((a, b) => a - b), score })
  }
  // Array.prototype.sort is stable, so equal scores keep the declared order.
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_RESULTS).map((entry) => ({ ...entry.action, matched: entry.matched }))
}

export interface CommandGroupModel<T extends CommandAction = CommandAction> {
  readonly heading: CommandGroupName
  readonly items: readonly T[]
}

/** Groups in a fixed order; empty groups are dropped rather than rendered bare. */
export function groupCommandActions<T extends CommandAction>(
  actions: readonly T[],
): readonly CommandGroupModel<T>[] {
  return GROUP_ORDER.map((heading) => ({
    heading,
    items: actions.filter((action) => action.group === heading),
  })).filter((group) => group.items.length > 0)
}
