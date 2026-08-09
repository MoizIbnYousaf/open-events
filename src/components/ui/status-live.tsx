import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

/** Polite live region for non-critical status updates (e.g. "Saved"). */
export function StatusLive({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span role="status" className={cn('text-sm text-muted-foreground', className)} {...props} />
  )
}
