import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

import { cn } from '../../lib/utils'

/**
 * The section-title recipe as a bare string, for the one context that cannot
 * take a component: files the entry chunk reaches. `ProductTour` is mounted by
 * the root shell, so every module it pulls in is weighed against the main gzip
 * budget — but a string constant is inlined at build time and costs nothing.
 *
 * Everywhere else, use `<SectionHeading>`. A class string cannot carry the
 * element choice, the data-slot, or the next change to the recipe; it is the
 * escape hatch, not the interface.
 */
export const SECTION_HEADING_CLASS = 'font-heading text-[15px] leading-snug font-medium'

/** The six document heading ranks, as `level` takes them. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/**
 * A section title inside the page: 15px medium, one step below the page `h1`
 * and one step above body text. Same recipe as `CardTitle`, promoted to its own
 * primitive because a heading and a card label are different jobs — `CardTitle`
 * defaults to a `<div>` because a page of cards is not a page of headings,
 * while this one IS document structure and defaults to `<h2>`.
 *
 * Headings differentiate by SIZE, never by a weight jump: medium is already the
 * default interface weight, so a title that also went semibold would only look
 * heavier, not more important.
 *
 * `level` picks the rank without losing the recipe — a subsection nested under
 * an `h2` asks for `level={3}` and the document outline stays honest:
 *
 * ```tsx
 * <SectionHeading level={3}>Conditional visibility</SectionHeading>
 * ```
 *
 * The rank is a prop rather than a `render={<h3 />}` element because the rank is
 * the ONLY thing these call sites were changing, and a childless heading literal
 * states the opposite of what the call site means: read on its own it is an
 * empty `<h3>`, which is what static accessibility checkers see. `level` builds
 * the heading around the children instead. `render` stays for the genuinely
 * different element — a `<legend>`, say — that the rank cannot express.
 *
 * This exists because the recipe was hand-copied into JSX seventeen times, five
 * of those copies silently dropping `font-heading` — invisible today because
 * `--font-heading` aliases `--font-sans`, and a visible regression the moment a
 * distinct heading face is bound. One definition is the whole point.
 */
function SectionHeading({
  className,
  level = 2,
  render,
  ...props
}: useRender.ComponentProps<'h2'> & { readonly level?: HeadingLevel }) {
  return useRender({
    defaultTagName: `h${level}`,
    props: mergeProps<'h2'>({ className: cn(SECTION_HEADING_CLASS, className) }, props),
    render,
    state: { slot: 'section-heading' },
  })
}

export { SectionHeading }
