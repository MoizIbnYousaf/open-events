import type { ComponentProps, ReactNode } from 'react'

import { cn } from '../../lib/utils'

/**
 * The one empty surface. A dashed hairline says "this box is real but has
 * nothing in it yet", which a solid card cannot say — a solid empty card reads
 * as a loading failure.
 *
 * Anatomy: optional icon tile → medium title → muted explanation → at most one
 * action. The explanation is where the product tells the reader what would put
 * something here; an empty state with only a title is a dead end wearing a
 * border.
 *
 * `children` is the action slot, so the caller keeps ownership of what the
 * button does and whether it exists at all.
 *
 * `title` may be a live-region node (a `StatusLive` span) when the empty
 * state doubles as a passive announcement — the `<p>` wrapper adds no role,
 * so the caller's region stays the only one. Being announced does not make a
 * title quieter: `StatusLive` carries `text-muted-foreground` because it is
 * usually a sentence beside a control, and on three surfaces that colour won
 * against this title and left the box with a grey heading the same weight and
 * size as its own description — no hierarchy at all. The title's ink is the
 * title's decision, so it is restored here, for the live region only, in both
 * tones.
 *
 * `tone="error"` is the failed-to-load face of the same box: icon and title
 * pick up the destructive ink while the dashed frame stays, because a load
 * failure is still "nothing is here", just not by choice.
 */
function EmptyState({
  icon,
  title,
  description,
  className,
  children,
  tone = 'default',
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  readonly icon?: ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly tone?: 'default' | 'error'
}) {
  return (
    <div
      data-slot="empty-state"
      data-tone={tone}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-9 text-center',
        className,
      )}
      {...props}
    >
      {icon !== undefined && icon !== null && (
        <span
          data-slot="empty-state-icon"
          aria-hidden="true"
          className={cn(
            'mb-1 grid size-10 place-items-center rounded-lg border border-border',
            tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {icon}
        </span>
      )}
      <p
        data-slot="empty-state-title"
        className={cn(
          'text-sm font-medium',
          // Scoped to this title, not a change to StatusLive: everywhere else
          // in the product a status sentence is correctly one step down.
          '[&_[role=status]]:text-inherit',
          tone === 'error' ? 'text-destructive' : 'text-foreground',
        )}
      >
        {title}
      </p>
      {description !== undefined && description !== null && (
        <p
          data-slot="empty-state-description"
          className="max-w-sm text-sm text-balance text-muted-foreground"
        >
          {description}
        </p>
      )}
      {children !== undefined && children !== null && (
        <div data-slot="empty-state-action" className="mt-2 flex items-center gap-2">
          {children}
        </div>
      )}
    </div>
  )
}

export { EmptyState }
