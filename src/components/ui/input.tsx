import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '../../lib/utils'

/**
 * 32px tall, 6px radius, hairline border, surface fill. The base font-size
 * stays 16px below `md` because anything smaller makes iOS Safari zoom the
 * page on focus; from `md` up it drops to the 14px chrome size.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive md:text-sm dark:bg-input/40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
