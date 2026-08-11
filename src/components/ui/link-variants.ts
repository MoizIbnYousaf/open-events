import { cva, type VariantProps } from 'class-variance-authority'

/**
 * The one text-link recipe. Sixteen hand-copied class strings said the same
 * thing slightly differently across the app; this is that string, once.
 *
 * The accent used here is the TEXT accent, not the fill accent: the blue that
 * carries white on a button is not dark enough to carry itself on the canvas
 * at 14px, so the two are separate tokens.
 *
 * It lives beside `link.tsx` rather than inside it because a router `<Link>`
 * WEARS the recipe instead of being rendered through `TextLink`:
 *
 *   <Link to="/admin" className={linkVariants()}>Admin</Link>
 *
 * An anchor that names itself is the point. Handing the router's `Link` to
 * `TextLink` through `render` moved the link text out of the anchor and into
 * the wrapper, which left every one of those call sites reading — to a person
 * skimming the file and to any static checker — as a link with no text at all.
 * `TextLink` stays for the anchors this file's own component renders.
 *
 * The split is also what keeps `link.tsx` exporting components and nothing
 * else, which is what a Fast Refresh boundary needs
 * (react-doctor/only-export-components).
 */
export const linkVariants = cva(
  'rounded-sm underline-offset-4 outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring',
  {
    variants: {
      variant: {
        default: 'font-medium text-link',
        quiet: 'text-muted-foreground hover:text-foreground',
        /* Inside a paragraph, where the underline has to be there at rest for
           the link to be findable without colour. */
        inline: 'text-link underline decoration-link/40 hover:decoration-link',
      },
      /**
       * Pointer targets under 24px fail WCAG 2.2 target-size; a link that sits
       * alone in a table cell or beside an icon opts in to a real hit area
       * without changing where the text sits.
       */
      hit: {
        true: 'inline-flex min-h-6 min-w-6 items-center',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      hit: false,
    },
  },
)

export type LinkVariants = VariantProps<typeof linkVariants>
