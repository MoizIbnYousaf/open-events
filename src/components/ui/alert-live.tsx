import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

/**
 * Assertive live region for errors and validation summaries. At most one is
 * live per form: per-field messages are FieldError nodes referenced by the
 * control's aria-describedby, so the same text is never announced twice.
 */
export function AlertLive({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      // Errors are RULES, never boxes: a 2px left edge marks the message
      // without building a red panel that competes with the form it belongs
      // to. `empty:hidden` keeps the rule off screen while the region — which
      // has to exist before its text arrives — is still empty.
      className={cn(
        'border-l-2 border-destructive pl-2 text-sm text-destructive empty:hidden',
        className,
      )}
      {...props}
    />
  )
}
