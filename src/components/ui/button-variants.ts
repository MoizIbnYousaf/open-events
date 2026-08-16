import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Density ladder: h-7 (28px) compact, h-8 (32px) default, h-9 (36px) large.
 * Buttons stay FLAT — no drop shadow, no bevel — so a row of controls reads as
 * one plane and the only raised surfaces in the product are overlays. The
 * hairline on `outline` is the whole elevation story.
 *
 * Icon-to-label gap tightens with the control: 4px at 12px text, 6px at 14px.
 * The padding on a slot side is pulled in one step so an optical centre lands
 * where the eye expects it rather than where the box maths does.
 *
 * `buttonVariants` is exported for ONE purpose: a navigation that is meant to
 * look like the primary action but is, honestly, a link. Rendering a `<Link>`
 * THROUGH `Button` merges button semantics onto an anchor — it announces as a
 * button, and the reader is promised something will happen here rather than
 * that they are about to go somewhere. Wearing the class recipe instead keeps
 * the anchor an anchor:
 *
 *   <Link to="/" className={buttonVariants()}>Go to the start</Link>
 *
 * Anything that actually DOES something still uses `Button`; the recipe is not
 * a way to skip the primitive's pending/disabled semantics, which a link has
 * no business having in the first place.
 *
 * The recipe sits beside `button.tsx` rather than inside it so that file
 * exports components and nothing else — what a Fast Refresh boundary needs
 * (react-doctor/only-export-components) — and because the callers above are
 * not rendering a `Button` at all.
 */
export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-hidden select-none motion-reduce:transition-none motion-reduce:transform-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring active:not-aria-[haspopup]:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:shadow-none aria-disabled:active:translate-y-0 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        outline:
          'border-border bg-card text-foreground hover:bg-foreground/5 aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-muted dark:hover:bg-foreground/10',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-foreground/10 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-foreground/5 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-foreground/10',
        /* A fill, never an outline or a text-only treatment: the only control
           in the product that is allowed to shout. */
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive-hover focus-visible:border-destructive focus-visible:ring-destructive',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-sm px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-sm px-2 text-sm in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-2 px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-sm in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7 rounded-sm in-data-[slot=button-group]:rounded-md',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
