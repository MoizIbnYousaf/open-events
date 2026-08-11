import * as React from 'react'

import { cn } from '../../lib/utils'

/**
 * Plain multi-line control styled to match `Input`. Registered with a Field
 * via `FieldControl` when labelled, exactly like other hand-rolled controls.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive md:text-sm dark:bg-input/30 dark:disabled:bg-input/80',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
