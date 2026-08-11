import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

/**
 * Polite live region for non-critical status updates (e.g. "Saved").
 *
 * aria-live/aria-atomic are declared explicitly rather than left to the
 * implicit mapping of role="status", so the announcement contract is visible
 * in the DOM. Never put aria-busy on this element: aria-busy tells assistive
 * tech to suppress the region's announcements, which silences the very message
 * it was added to convey.
 */
export function StatusLive({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
