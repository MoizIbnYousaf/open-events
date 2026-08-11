import type { ComponentProps, ReactNode } from 'react'

import { cn } from '../../lib/utils'

/**
 * A real `<select>` with a real `<option>` list, styled to sit in the same
 * field recipe as `Input` and `Textarea`.
 *
 * This is NOT a lesser version of `./select` — it is the one to reach for
 * whenever the contract is the platform's. A native select is the only control
 * that a `<form>` submits without a hidden input, that `required` validates and
 * reports through `onInvalid`, that `user.selectOptions` drives in a unit test,
 * and that `selectOption` drives in Playwright. Reach for the Base UI `Select`
 * only when the list needs things `<option>` cannot hold — grouped rich rows,
 * icons, a check indicator, a scrollable popup with its own keyboard model.
 *
 * The platform appearance is stripped so the chevron can be ours (24-grid,
 * round caps, `icons.tsx`'s size-compensated 1.75 weight at this 16px render
 * size, one step below the text like every other icon), and
 * the right padding is reserved for it — the glyph sits in a positioned
 * wrapper rather than inside the control, because nothing can be painted
 * inside a `<select>`.
 *
 * `containerProps` reaches the wrapper for width and layout; `className`
 * always lands on the control itself, so `{...register()}` and every native
 * attribute behave exactly as they would on a bare `<select>`.
 *
 * The two naming attributes are named in the signature rather than left to
 * arrive anonymously inside `...props`. A `<select>` MUST be named — by an
 * external `<label for>`, or by one of these — and this primitive is the only
 * place that requirement can be stated once for every call site. Spelling them
 * out is also what tells a reader (and a static checker) that the control's
 * accessible name is supplied by the caller, not missing.
 */
function NativeSelect({
  className,
  children,
  containerProps,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: ComponentProps<'select'> & {
  readonly containerProps?: ComponentProps<'div'>
  readonly children?: ReactNode
}) {
  const { className: containerClassName, ...restContainerProps } = containerProps ?? {}
  return (
    <div
      data-slot="native-select-container"
      className={cn('relative w-full', containerClassName)}
      {...restContainerProps}
    >
      <select
        data-slot="native-select"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'h-8 w-full min-w-0 appearance-none rounded-md border border-input bg-card py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive md:text-sm dark:bg-input/40',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
      >
        <path d="m19.5 8.25-7.5 7.5-7.5-7.5" />
      </svg>
    </div>
  )
}

export { NativeSelect }
