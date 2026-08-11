import type { ComponentProps } from 'react'

/**
 * The single icon surface for the product.
 *
 * ARTWORK PROVENANCE IS PER SECTION, NOT PER FILE. This module is drawn from
 * two sources and the divider below says exactly where one ends and the other
 * begins:
 *
 *  - above `First-party drawings`: path data derived from Heroicons v2
 *    (outline), MIT-licensed, Copyright (c) Tailwind Labs — see
 *    THIRD_PARTY_NOTICES.md. It is copied as path data rather than added as a
 *    runtime dependency: a package would put a third-party name into whatever
 *    chunk imports it, and the entry chunk is grepped for exactly that.
 *  - below it: glyphs drawn for this product, owed to nobody, sharing only the
 *    geometry contract.
 *
 * This docblock used to claim the whole file was Heroicons-derived and to
 * instruct every future addition to copy from Heroicons. That stopped being
 * true the moment the first original glyph landed, and a provenance note that
 * over-claims is as much a defect as one that under-claims: it would have had
 * us attributing our own drawings to Tailwind Labs.
 *
 * ENTRY-CHUNK RULE: this module must only ever be imported from ROUTE-level
 * chunks. Anything mounted by the root shell — the shell itself, the command
 * palette, the crash states, dialog and select — draws its glyphs inline, in
 * file, to keep the entry chunk inside its gzip budget. If you find yourself
 * importing from here in a file the entry chunk reaches, inline the path
 * instead.
 *
 * Two defects in the system this was modelled on are fixed here: the size prop
 * is typed rather than open, and every glyph is `aria-hidden` by default, so an
 * icon can never leak into the accessible name of the control that holds it.
 * Icon-only controls carry their own `aria-label`.
 *
 * Optical compensation: a 1.5 stroke drawn on a 24 grid disappears when the box
 * shrinks, so the stroke thickens as the glyph gets smaller — 1.5 at 20px and
 * up, 1.75 at 16–18px, 2 at 14px and below. Same apparent weight at every size.
 *
 * EXPORTS TRACK CALLERS. This module carried thirty-five glyphs and rendered
 * six; the other twenty-nine were dead weight in every route chunk that touched
 * the module, and five of them (SubmissionIcon, AgendaIcon, EvaluationIcon,
 * ReadinessIcon, EventIcon) were a second, divergent nav-icon set that nothing
 * could ever render, because the entry-chunk rule above forces `AppShell` to
 * draw its own. Adding a glyph here is therefore the same commit as its first
 * call site — and it lands in the section that matches WHERE IT CAME FROM,
 * with its provenance declared: copied from Heroicons v2
 * `optimized/24/outline` goes above the divider, under the row
 * THIRD_PARTY_NOTICES.md already carries for this file; drawn here goes below
 * it. Putting one in the wrong section is a provenance error no script will
 * catch. Deleted artwork is recoverable from git history.
 */

/** 16 pairs with 14px text, 20 is the standalone default, 24 fills a toolbar. */
export type IconSize = 12 | 14 | 16 | 18 | 20 | 24 | 28 | 32

export interface IconProps extends Omit<ComponentProps<'svg'>, 'children' | 'viewBox'> {
  readonly size?: IconSize
}

function strokeFor(size: IconSize): string {
  if (size <= 14) return '2'
  if (size <= 18) return '1.75'
  return '1.5'
}

function createIcon(displayName: string, d: readonly string[]) {
  function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeFor(size)}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {d.map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
    )
  }
  Icon.displayName = displayName
  return Icon
}

/* Chrome and navigation ---------------------------------------------------- */

export const ChevronDownIcon = createIcon('ChevronDownIcon', ['m19.5 8.25-7.5 7.5-7.5-7.5'])
export const ChevronUpIcon = createIcon('ChevronUpIcon', ['m4.5 15.75 7.5-7.5 7.5 7.5'])
/**
 * The product's ONE "back" glyph. A chevron and an arrow both pointed left on
 * two detail pages that do the same thing; an arrow says "back to a place",
 * a chevron says "previous item in a series", and only one of those is what a
 * back-link means. The chevron was deleted with its last caller (recoverable
 * from git history if a paginator ever needs it).
 */
export const ArrowLeftIcon = createIcon('ArrowLeftIcon', ['M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18'])

/* Verbs -------------------------------------------------------------------- */

export const CheckIcon = createIcon('CheckIcon', ['m4.5 12.75 6 6 9-13.5'])

/* Product nouns ------------------------------------------------------------ */

export const InboxIcon = createIcon('InboxIcon', [
  'M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z',
])

/* First-party drawings ------------------------------------------------------
 *
 * PROVENANCE: everything ABOVE this line is Heroicons v2 outline path data,
 * MIT, covered by this file's row in THIRD_PARTY_NOTICES.md. Everything BELOW
 * it was drawn for this product and is owed to nobody — different construction
 * (explicit outlines with arc corners rather than Heroicons' compound curves),
 * different coordinates, same geometry contract: 24 viewBox, 1.5 stroke at
 * 20px and up, round caps and joins, so the two halves sit in one system.
 *
 * The provenance gate (`scripts/notices-check.mjs`) works at file granularity
 * and passes this file through its Heroicons row, so this comment — and the
 * matching note in THIRD_PARTY_NOTICES.md — is what keeps the claim honest.
 * Adding a Heroicons-derived glyph below this line, or a hand-drawn one above
 * it, is a provenance error even though no script will catch it.
 *
 * They exist because thirteen empty states across the product all wore the
 * same inbox: a builder with no draft, a version that captured nothing, an
 * unstaffed proposal and an undefined rubric are four different absences, and
 * an icon tile that says "empty" four times says nothing.
 */

/** A single sheet with a turned corner: one form, one draft, one version. */
export const DocumentIcon = createIcon('DocumentIcon', [
  'M14 3H7.5A2 2 0 0 0 5.5 5v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7.5L14 3Z',
  'M14 3v3.5a1 1 0 0 0 1 1h3.5',
  'M9 12.5h6M9 16h4',
])

/** Two sheets, one behind the other: a form's published version history. */
export const DocumentStackIcon = createIcon('DocumentStackIcon', [
  'M9 6.5V4.5A1.5 1.5 0 0 1 10.5 3H16l3.5 3.5V15a1.5 1.5 0 0 1-1.5 1.5H16',
  'M13.5 7.5h-8A1.5 1.5 0 0 0 4 9v10.5A1.5 1.5 0 0 0 5.5 21h8a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5Z',
])

/** A five-point star: the committee's rating, and what it is scored on. */
export const StarIcon = createIcon('StarIcon', [
  'M12 3.4l2.18 5.61 6 .33-4.66 3.8 1.54 5.82L12 15.7l-5.06 3.26 1.54-5.82-4.66-3.8 6-.33L12 3.4Z',
])

/** A clipboard with a ruled list: the rubric a proposal is measured against. */
export const ClipboardIcon = createIcon('ClipboardIcon', [
  'M9 4.5H7.5A1.5 1.5 0 0 0 6 6v13.5A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15',
  'M9.75 3h4.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 9 5.25v-1.5A.75.75 0 0 1 9.75 3Z',
  'M9 11h6M9 14.5h4',
])
