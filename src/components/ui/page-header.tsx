import type { ComponentProps } from 'react'

import { cn } from '../../lib/utils'

/**
 * The page toolbar: title, optional description, actions pushed to the trailing
 * edge.
 *
 * The title is 20px semibold, not 24px, and it lives in a row with the actions
 * rather than floating above the content — a page title is chrome, and chrome
 * belongs in a strip. Headings differentiate from body text by SIZE; nothing
 * in the product jumps a weight to look important.
 *
 *   <PageHeader>
 *     <PageHeaderContent>
 *       <PageHeaderTitle>Submissions</PageHeaderTitle>
 *       <PageHeaderDescription>42 proposals</PageHeaderDescription>
 *     </PageHeaderContent>
 *     <PageHeaderActions>…</PageHeaderActions>
 *   </PageHeader>
 *
 * FROM `lg` UP IT IS A REAL TOOLBAR: 56px, sticky to the top of the content
 * scroller, on the canvas colour with a hairline under it. C0 §7's per-page
 * toolbar was folded into the site toolbar so the product would not spend two
 * stacked 56px rows of vertical space — but the consequence was that the h1
 * scrolled away, so on a long submissions list or agenda the reader had no
 * standing answer to "which page am I on". Sticking the row it already lives in
 * costs no extra chrome height and gets the answer back.
 *
 * Desktop only, deliberately. Below `lg` this row wraps onto two lines, and a
 * fixed height would clip the second; a narrow viewport also has less height to
 * give away to anything pinned. The row's own anatomy is what makes 56px safe
 * up there — the title truncates, the actions do not shrink, so nothing here
 * grows past one line. A caller adding a third line to the content column is
 * the one thing that would break it.
 *
 * `z-40` is one rung above the table primitive's sticky ladder (see
 * `TABLE_LAYER` in `table.tsx`, whose top rung is `z-30`): a sticky column head
 * scrolling over the page title would be exactly backwards.
 *
 * Horizontal padding is deliberately NOT set here. Every caller already sits in
 * a content container that positions this row, and adding padding would shift
 * the title out of line with the content beneath it.
 */
function PageHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        // `min-w-0` on the row itself, not only on its content column: a flex
        // item defaults to min-width:auto, so a long unbroken title refused to
        // shrink below its own text and pushed the page sideways at 390px —
        // the truncation the title asks for cannot happen inside a row that
        // will not narrow.
        'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2',
        'lg:sticky lg:top-0 lg:z-40 lg:h-14 lg:flex-nowrap lg:border-b lg:border-border lg:bg-background',
        className,
      )}
      {...props}
    />
  )
}

function PageHeaderContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-header-content"
      className={cn('flex min-w-0 flex-col gap-0.5', className)}
      {...props}
    />
  )
}

function PageHeaderTitle({ className, ...props }: ComponentProps<'h1'>) {
  return (
    <h1
      data-slot="page-header-title"
      className={cn('truncate font-heading text-xl leading-tight font-semibold', className)}
      {...props}
    />
  )
}

function PageHeaderDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="page-header-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

/** Trailing edge by default — `ml-auto` is part of the primitive, not the page. */
function PageHeaderActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-header-actions"
      className={cn('flex shrink-0 items-center gap-2 sm:ml-auto', className)}
      {...props}
    />
  )
}

export { PageHeader, PageHeaderContent, PageHeaderTitle, PageHeaderDescription, PageHeaderActions }
