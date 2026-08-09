import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

/** Assertive live region for errors and validation summaries. */
export function AlertLive({ className, ...props }: ComponentProps<'div'>) {
  return <div role="alert" className={cn('text-sm text-destructive', className)} {...props} />
}
