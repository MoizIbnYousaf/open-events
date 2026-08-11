import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

/**
 * A native `<input type="checkbox">` with its platform appearance stripped and
 * ours painted on.
 *
 * Native on purpose. A composite widget would need a hidden input to be
 * submittable, a controller to be registered with react-hook-form, and a role
 * to be announced — the native control arrives with all three, and the only
 * thing wrong with it is the look. So we change the look and nothing else:
 * every prop, ref, `required`, `form`, and `{...register()}` spread lands on a
 * real checkbox.
 *
 * 16px box, 4px radius, hairline at rest, accent fill plus a white tick when
 * checked. Pair it with a <label> — this primitive deliberately owns no text.
 */
function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer appearance-none rounded-[4px] border border-input bg-card transition-colors outline-none',
        'checked:border-primary checked:bg-primary checked:[background-image:var(--control-tick)] checked:[background-position:center] checked:[background-repeat:no-repeat] checked:[background-size:0.75rem]',
        'indeterminate:border-primary indeterminate:bg-primary',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive',
        'dark:bg-input/40',
        className,
      )}
      {...props}
    />
  )
}

export { Checkbox }
