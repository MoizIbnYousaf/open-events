import type { ComponentProps } from 'react'
import { createLink } from '@tanstack/react-router'

import { cn } from '../../../lib/utils'
import { ArrowLeftIcon } from '../../../components/ui/icons'
import { linkVariants } from '../../../components/ui/link-variants'

/**
 * The one way back.
 *
 * Four detail surfaces each grew their own: two of them carried the SAME label
 * ("Back to event settings") on sibling pages and rendered in different
 * colours, two drew different arrows, and the four sat in four different places
 * — below the content, above the h1, and inside the page header's trailing
 * action cluster. A reader who learns where the exit is on one record page
 * should find it in the same place on the next one.
 *
 * The settled recipe: quiet ink (an exit is not the page's headline), one
 * arrow — `ArrowLeftIcon`, which says "back to a place" where a chevron says
 * "previous item in a series" — and a real hit area, because the glyph plus two
 * words is otherwise a target under the WCAG 2.2 minimum.
 *
 * PLACEMENT IS PART OF THE RECIPE: above the page header, first thing in the
 * content column. The reader who wants out of a record wants out now, not after
 * scrolling past every panel on it, and a link parked in `PageHeaderActions`
 * competes with the actions that act ON the record.
 *
 * WHEN ONE SHOULD EXIST — the clause this recipe was missing. It settled what a
 * way back looks like and where it sits, and never said on which surfaces one
 * belongs at all. The rule: A BACKLINK EXISTS ONLY WHERE THE RAIL CANNOT REACH
 * THE ORIGIN.
 *
 * The rail renders on every organizer route at every width — the narrow fold is
 * CSS only, nothing unmounts — and it marks the destination the reader is
 * standing on with `aria-current`. So for any page the rail itself lists, the
 * rail is already the way back, and a second exit in the content column does
 * not merely duplicate it: it contradicts it. "Back to event settings" on
 * Taxonomies claims Taxonomies sits inside Event settings while the rail three
 * inches to its left shows the two as siblings of one group. Two navigation
 * systems asserting incompatible hierarchies on one screen is worse than one
 * fewer link, so both of those went.
 *
 * What is left is exactly the set the rail has no vocabulary for — one
 * submission out of a list, one version out of a form's history. Those are the
 * surfaces where the reader genuinely has nowhere else to press.
 *
 * Route-chunk only, like everything that touches `components/ui/icons`.
 *
 * It IS the router link — built with TanStack's own `createLink`, so `to` and
 * `params` keep their route types — rather than a wrapper handed a childless
 * `<Link />` through `render`. That older shape moved the link text out of the
 * anchor and into the wrapper, which left every call site reading as a link
 * with no text at all (shadscan/links-have-accessible-names).
 *
 * ```tsx
 * <BackLink
 *   to="/admin/events/$slug/submissions"
 *   params={{ slug }}
 *   activeOptions={{ exact: true }}
 * >
 *   Back to submissions
 * </BackLink>
 * ```
 *
 * Callers pass `activeOptions={{ exact: true }}` whenever the destination path
 * is a prefix of the current one — TanStack matches by prefix and sets
 * `aria-current="page"` itself, so without it the way back announces as the
 * page the reader is already standing on.
 */
function BackLinkAnchor({ className, children, ...props }: ComponentProps<'a'>) {
  return (
    // The wrapper is not decoration: `hit` makes the link `inline-flex`, and an
    // inline-flex box dropped straight into the surrounding grid is stretched to
    // the column width, which hands a full-bleed click target to a two-word
    // link. The block wrapper gives it back its intrinsic width at every call
    // site at once.
    <div>
      <a
        {...props}
        className={cn(
          linkVariants({ variant: 'quiet', hit: true, className: 'gap-1 text-sm' }),
          className,
        )}
      >
        <ArrowLeftIcon size={14} />
        {children}
      </a>
    </div>
  )
}

const BackLink = createLink(BackLinkAnchor)

export default BackLink
