import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

/**
 * A keycap.
 *
 * `aria-hidden` by default, and that default is the point: the chord is not
 * the accessible name of anything. Whatever the cap decorates already carries
 * its own name, and the chord itself is published to assistive tech through
 * `aria-keyshortcuts` on the control that owns it — so reading the glyphs a
 * second time only produces "search destinations command K". A caller that
 * genuinely needs the cap announced (prose that has no owning control) passes
 * `aria-hidden={false}`.
 *
 * `font-sans` is deliberate: a `<kbd>` renders monospace by default, and a
 * monospace ⌘ next to 14px Inter reads as a bug rather than as a key.
 *
 * Drawn with no icon import and no dependency — this ships inside the entry
 * chunk (the shell toolbar, the rail hint and the theme control all mount it),
 * which is held to a gzip budget and grepped for third-party icon strings.
 */
function Kbd({ className, 'aria-hidden': ariaHidden = true, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      aria-hidden={ariaHidden}
      className={cn(
        'rounded-sm bg-foreground/[0.06] px-1.5 py-0.5 font-sans text-[10px] leading-4 font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
