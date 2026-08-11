import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

/**
 * A chip, not a button: 20px tall, 4px radius, 12px medium label, 6px side
 * padding. Every tone is a TINT — a saturated fill at this size reads as an
 * action the reader can take, and a status chip is never actionable. The
 * strongest thing a badge is allowed to do is carry colour.
 *
 * That sentence used to be false: a `link` variant shipped underneath it with a
 * hover-underline affordance, duplicated verbatim from `button.tsx`, used by
 * nothing. The variant is gone rather than the sentence — a badge that needs to
 * be pressed is a Button, and a badge that needs to navigate is a TextLink.
 */

/**
 * The state marker: a 4px round dot before the label, painted from the chip's
 * own text colour, so the marker can never disagree with the word beside it.
 *
 * It exists because this product spends colour differently from most. One
 * structural accent, and no multi-hue chip table, means a *state* chip and a
 * *value* chip cannot be told apart by tint the way they could if every state
 * owned a hue. The dot puts the distinction back on a channel we still own —
 * shape — and shape survives greyscale, colour-blindness and a photocopier,
 * which a tint alone does not.
 *
 * It is a pseudo-element and not a child `<span>` on purpose, and the reason is
 * a contract rather than a preference: the badge's own `[&>svg]` rules and the
 * chip-in-a-cell DOM contracts asserted elsewhere both read the badge's real
 * children, and a marker that shows up in that list would move a shape other
 * tests are pinned to. `::before` is a flex item too, so the recipe's existing
 * `gap-1` spaces it without a second measurement.
 */
const BADGE_DOT_CLASS =
  "before:size-1 before:shrink-0 before:rounded-full before:bg-current before:content-['']"

/**
 * The in-flight face of a state chip: the same dot, breathing.
 *
 * A chip is the thing whose truth is in question while a publish or a
 * round-state change is in the air, and until now it said nothing — the button
 * beside it went pending while the chip claimed the old state as calmly as
 * ever. The animation is deliberately silent: assistive tech already learns
 * about these waits from the existing live region, and this product allows
 * exactly one of those, so a chip that announced itself would be the second.
 *
 * `opacity-100` is written out rather than left implied, because a looping
 * animation must name the state it rests in — that resting value is what the
 * reduced-motion collapse in the global stylesheet leaves on screen, and what
 * the dot returns to the moment the wait ends.
 */
const BADGE_PENDING_CLASS = 'before:animate-pulse before:opacity-100'

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 text-xs font-medium whitespace-nowrap transition-all motion-reduce:transition-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive aria-invalid:ring-destructive [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-foreground/[0.06] text-foreground dark:bg-foreground/10',
        secondary: 'bg-primary/10 text-link dark:bg-primary/20',
        destructive: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
        outline: 'border-border text-muted-foreground [a]:hover:text-foreground',
        ghost: 'text-muted-foreground [a]:hover:text-foreground',
      },
      dot: {
        true: BADGE_DOT_CLASS,
        false: '',
      },
      pending: {
        true: BADGE_PENDING_CLASS,
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      dot: false,
      pending: false,
    },
  },
)

/**
 * `dot` is opt-in because the marker is a claim: it says "this chip names a
 * state", and a chip that names a track or a session type would be lying with
 * it. `pending` is the in-flight face of that same marker, so it brings the dot
 * with it — animating an element that was never rendered would be a wait with
 * no indicator at all.
 *
 * Neither prop touches the chip's text. A caller must not swap the label while
 * a change is in the air: the label is the state the reader last had confirmed,
 * and it stays true until the server says otherwise.
 */
function Badge({
  className,
  variant = 'default',
  dot = false,
  pending = false,
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  const isPending = pending === true
  const hasDot = dot === true || isPending
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant, dot: hasDot, pending: isPending }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
      dot: hasDot,
      pending: isPending,
    },
  })
}

export { Badge }
