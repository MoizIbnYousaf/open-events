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
      className={cn('text-sm text-destructive', className)}
      {...props}
    />
  )
}
