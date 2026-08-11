import * as React from 'react'

import { cn } from '../../lib/utils'

/**
 * Plain multi-line control styled to match `Input`. Registered with a Field
 * via `FieldControl` when labelled, exactly like other hand-rolled controls.
 *
 * Prose surfaces (abstracts, descriptions) are read as well as written, so the
 * text sits at the 15px reading size rather than the 14px chrome size.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-card px-2.5 py-1.5 text-base leading-normal transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive md:text-[15px] dark:bg-input/40',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
