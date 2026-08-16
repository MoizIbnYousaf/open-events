import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

/**
 * The product's one illustration: two sheets of paper on a slight tilt.
 *
 * It is drawn in CSS from the same tokens as everything around it, so it ships
 * no asset, costs no request, and inverts with the theme instead of being a
 * light-mode PNG someone has to remember to swap.
 *
 * The version this replaces was two `absolute inset-0` boxes at ±6° with the
 * front one filled `bg-card`. In dark mode `--card` IS `--background` (the
 * elevation inversion in C0 §1), so the front sheet occluded nothing and the
 * two outlines crossed into a scribble; in light, #ffffff on a #fcfcfc canvas
 * was barely better. At 44 × 56px it read as a rendering fault rather than a
 * drawing — on the success screen at the end of the speaker journey.
 *
 * Three things fix it:
 *  - the sheets are OFFSET, not concentric, so there are two shapes rather than
 *    one outline crossing itself;
 *  - the front sheet is filled with `--muted`, the one surface token that
 *    differs from BOTH the canvas and a card in BOTH schemes, so it occludes
 *    the sheet behind it wherever it is placed;
 *  - the hairlines are the opaque border token, because two alpha hairlines
 *    crossing at a tilt double up into a darker smudge exactly where the
 *    drawing needs to read as one edge.
 *
 * Decorative by definition, so it is `aria-hidden` and takes no label. Callers
 * pass margin through `className`; the size is the primitive's.
 */
function PaperStack({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="paper-stack"
      aria-hidden="true"
      className={cn('relative block h-12 w-16', className)}
      {...props}
    >
      {/* The sheet underneath: only its edge shows, which is what makes the
          pair read as a stack rather than as one tilted rectangle. */}
      <span className="absolute top-0 bottom-2 left-0 w-11 -rotate-6 rounded-md border border-border-opaque bg-card" />
      <span className="absolute top-2 right-0 bottom-0 w-11 rotate-3 rounded-md border border-border-opaque bg-muted">
        {/* Two ruled lines: at this size they are the difference between "a
            sheet of paper" and "a rounded rectangle". */}
        <span className="absolute top-3 right-2 left-2 block h-px bg-foreground/15" />
        <span className="absolute top-5 right-4 left-2 block h-px bg-foreground/15" />
      </span>
    </span>
  )
}

export { PaperStack }
