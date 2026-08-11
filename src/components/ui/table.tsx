import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type ComponentProps,
  type Ref,
} from 'react'

import { cn } from '../../lib/utils'

/**
 * The stacking ladder for sticky table chrome, defined once, here, beside the
 * only primitive allowed to use it: column heads sit above a pinned identity
 * column, which sits above a footer. Every one of those can be sticky at the
 * same time, and without a single ordering they fight — the header slides under
 * the pinned column on one surface and over it on the next.
 *
 * Named rather than written inline so no surface ever invents a `z-40` to win
 * an argument it should not be having with a primitive.
 */
const TABLE_LAYER = {
  /** Column heads: above everything else in the table. */
  header: 'z-30',
  /** The pinned identity column: above the body, below the heads. */
  pinnedCell: 'z-20',
  /** Totals and summaries: above the body only. */
  footer: 'z-10',
} as const

/*
 * The three sticky recipes are spelled out as whole literals rather than built
 * from TABLE_LAYER at runtime, because Tailwind compiles by reading this file
 * as text: a class assembled from a template string is a class that never gets
 * generated. A unit test asserts each literal still carries its rung, so the
 * ladder cannot drift away from the recipes that are supposed to obey it.
 */
const STICKY_HEADER_CLASS =
  '[&_th]:sticky [&_th]:top-0 [&_th]:z-30 [&_th]:bg-[var(--table-header-bg)]'
const PINNED_HEAD_CLASS = 'sticky left-0 z-30 bg-[var(--table-header-bg)]'
const PINNED_CELL_CLASS = 'sticky left-0 z-20 bg-[var(--table-row-bg)]'

/** Lets `TableCaption` claim the id the scroll container points its name at. */
const TableCaptionIdContext = createContext<string | undefined>(undefined)

/**
 * A real `<table>`, styled — not a grid of divs. The data on these pages is
 * tabular, and the semantics (`scope`, `<caption>`, row/column association)
 * are what make it navigable by screen reader; a flex list throws all of that
 * away for a border radius.
 *
 * Density: 14px cells, 8px vertical padding, hairline rules between rows, and
 * a 12px medium column head one step below the text colour. Nothing is
 * zebra-striped — the rules carry the row rhythm and stripes would fight them.
 *
 * The wrapper owns horizontal overflow so a wide table scrolls inside its own
 * box instead of pushing the page sideways on a phone. That wrapper is not an
 * implementation detail the caller can ignore: it is the element that scrolls,
 * so it is the only element a scroll listener, a sticky offset or a
 * scroll-edge custom property can be hung on. `containerRef` and
 * `containerProps` hand it over — `className` and every table attribute still
 * land on the `<table>`, exactly as on a bare one.
 *
 * `bordered` draws the frame the wrapper needs when a table is the whole
 * surface rather than a row inside a card. It belongs here because a
 * hand-wrapped `<div className="ring-1 …">` outside the scroller puts the
 * rounding on a box the content scrolls past, and clips nothing.
 *
 * SCROLL EDGES. When a wide table is scrolled sideways, the columns disappear
 * under a hard edge with nothing to say they continue — at 390px the pinned
 * identity column simply amputated the neighbouring header, which then read as
 * the typo "/ersion". A scroll listener flips two custom properties on the
 * container and an inset shadow reads them, so an edge that has content behind
 * it says so and an edge that does not stays clean. The shadow is inset on the
 * scroller itself rather than a pair of overlay elements: an inset shadow is
 * painted against the padding box, so it stays welded to the visual edge
 * instead of scrolling away with the content, and it costs no extra DOM.
 * (Geometry and alphas written for this product; no upstream CSS was
 * transcribed — see D6's re-express rule.)
 */
function Table({
  className,
  bordered = false,
  containerRef,
  containerProps,
  children,
  ...props
}: ComponentProps<'table'> & {
  /** Hairline ring + radius on the scroll container for standalone tables. */
  readonly bordered?: boolean
  readonly containerRef?: Ref<HTMLDivElement>
  readonly containerProps?: ComponentProps<'div'>
}) {
  const { className: containerClassName, ...restContainerProps } = containerProps ?? {}
  const scroller = useRef<HTMLDivElement | null>(null)
  const captionId = useId()
  // Direct children only, which is where every caption in this codebase lives —
  // and where the HTML spec puts it. Pointing `aria-labelledby` at an id that
  // was never rendered would name the region nothing, so the name is claimed
  // only when the caption that supplies it is actually there.
  const hasCaption = Children.toArray(children).some(
    (child) => isValidElement(child) && child.type === TableCaption,
  )

  // The primitive needs the scroller for its own listener AND the caller may
  // want it; `useImperativeHandle` is how React hands one node to a forwarded
  // ref without anybody reaching into a prop and assigning to it.
  useImperativeHandle(containerRef, () => scroller.current as HTMLDivElement, [])

  useEffect(() => {
    const node = scroller.current
    if (node === null) return
    const update = () => {
      const overflow = node.scrollWidth - node.clientWidth
      // A pixel of tolerance: fractional layout widths never settle on an
      // exact 0, and a shadow that flickers at rest is worse than none.
      node.dataset.scrollStart = node.scrollLeft > 1 ? 'true' : 'false'
      node.dataset.scrollEnd = node.scrollLeft < overflow - 1 ? 'true' : 'false'
    }
    update()
    node.addEventListener('scroll', update, { passive: true })
    // The edges also change when nothing scrolls: a column that grows, or a
    // window that narrows, turns a table that fitted into one that does not.
    //
    // Those frames arrive at frame rate for the whole length of a window drag,
    // and `update` opens with `node.scrollWidth` — a layout read performed
    // inside a ResizeObserver callback, which is a forced synchronous reflow
    // and the ordinary way to earn "ResizeObserver loop completed with
    // undelivered notifications" in the console. Sub-pixel jitter cannot flip
    // either boolean, so a width that moved by a pixel or less is answered by
    // doing nothing at all — decided from the width the entry already carries,
    // so the frame costs no measurement either. This is the same tolerance the
    // scroll comparison above has always had, finally applied to the resize
    // path that was missing it.
    //
    // A threshold, deliberately, and not a settle delay: an edge shadow that
    // arrives after the resize has finished is an edge shadow that spent that
    // whole time lying about whether there was more content.
    let observedWidth = Number.NaN
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const width = entries[entries.length - 1]?.contentRect.width ?? Number.NaN
            // NaN fails every comparison, so the first frame — and any frame an
            // engine hands over without a rect — falls through and measures.
            if (Math.abs(width - observedWidth) <= 1) return
            observedWidth = width
            update()
          })
    observer?.observe(node)
    return () => {
      node.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [])

  return (
    <TableCaptionIdContext.Provider value={captionId}>
      <div
        data-slot="table-container"
        className={cn(
          'w-full overflow-x-auto overscroll-x-contain',
          '[--table-header-bg:var(--color-background)]',
          '[--table-edge-start:transparent] [--table-edge-end:transparent]',
          'data-[scroll-start=true]:[--table-edge-start:var(--table-edge-shadow)]',
          'data-[scroll-end=true]:[--table-edge-end:var(--table-edge-shadow)]',
          'shadow-[inset_10px_0_8px_-10px_var(--table-edge-start),inset_-10px_0_8px_-10px_var(--table-edge-end)]',
          // The tab stop below is a real stop, so it gets the product's focus
          // ring rather than the browser's default outline.
          'outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
          bordered && 'rounded-lg ring-1 ring-border',
          containerClassName,
        )}
        {...restContainerProps}
        // Everything below is last, so `containerProps` cannot drop it.
        //
        // A scroll container is only reachable by keyboard if something inside
        // it can take focus, and a table of plain text has nothing — so the
        // container itself takes a tab stop. A focusable container that is
        // unnamed then announces as a bare group, so the caption that already
        // names the table names the region holding it too. `group` rather than
        // `region`: this is not a landmark, and a page of tables is not a page
        // of landmarks.
        ref={scroller}
        role="group"
        aria-labelledby={hasCaption ? captionId : undefined}
        tabIndex={0}
      >
        <table
          data-slot="table"
          className={cn('w-full caption-bottom border-collapse text-left text-sm', className)}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableCaptionIdContext.Provider>
  )
}

/**
 * `sticky` pins the column heads to the top of the scroll container, for tables
 * long enough that the heads would otherwise scroll away from the rows they
 * name. It is opt-in because a short table gains nothing and pays a repaint.
 *
 * The offset goes on the `<th>` cells rather than the `<thead>`: sticky on a
 * table section is the newer behaviour and the cells are what every engine has
 * always honoured. They need an opaque fill for the same reason a pinned cell
 * does — rows slide underneath.
 */
function TableHeader({
  className,
  sticky = false,
  ...props
}: ComponentProps<'thead'> & { readonly sticky?: boolean }) {
  return (
    <thead
      data-slot="table-header"
      data-sticky={sticky ? '' : undefined}
      className={cn(
        '[&_tr]:border-b [&_tr]:border-border',
        sticky && STICKY_HEADER_CLASS,
        className,
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t border-border font-medium', className)}
      {...props}
    />
  )
}

/**
 * The row publishes its own current background as `--table-row-bg`, and any
 * sticky cell inside it paints with that variable instead of guessing.
 *
 * This is not decoration. A pinned cell MUST be opaque or the scrolling columns
 * slide visibly underneath it, and the wash it has to match is the row's — which
 * changes on hover. When the two were written separately, the pinned identity
 * column painted `--muted` while its own row painted a 6% white alpha, and every
 * hovered row grew a lighter rectangle over the Title column.
 *
 * The hover wash is one class in both schemes — an opaque `color-mix`, not an
 * alpha over an unknown backdrop — for two reasons. A sticky cell can copy an
 * opaque colour and cannot copy an alpha. And a single class is one class for
 * tailwind-merge to collapse, so a caller passing `hover:bg-muted` overrides the
 * row in light AND dark; the previous `dark:hover:` twin survived the merge and
 * silently won back the dark theme.
 */
function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        '[--table-row-bg:var(--color-background)]',
        '[--table-row-hover:color-mix(in_oklab,var(--color-foreground)_3%,var(--color-background))]',
        '[--table-row-selected:color-mix(in_oklab,var(--color-foreground)_5%,var(--color-background))]',
        'dark:[--table-row-hover:color-mix(in_oklab,var(--color-foreground)_6%,var(--color-background))]',
        'dark:[--table-row-selected:color-mix(in_oklab,var(--color-foreground)_8%,var(--color-background))]',
        'border-b border-border transition-colors',
        'hover:[--table-row-bg:var(--table-row-hover)] hover:bg-[var(--table-row-hover)]',
        'data-[state=selected]:[--table-row-bg:var(--table-row-selected)] data-[state=selected]:bg-[var(--table-row-selected)]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * `pinned` holds the identity column in place while the rest of the row scrolls
 * sideways, so a narrow screen never loses track of which record a cell belongs
 * to. The fill comes from the row's own `--table-row-bg`, which is what keeps
 * the pinned cell and its row one colour in every state and both schemes.
 */
function TableHead({
  className,
  pinned = false,
  ...props
}: ComponentProps<'th'> & { readonly pinned?: boolean }) {
  return (
    <th
      data-slot="table-head"
      data-pinned={pinned ? '' : undefined}
      className={cn(
        'h-8 px-2 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground',
        pinned && PINNED_HEAD_CLASS,
        className,
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  pinned = false,
  ...props
}: ComponentProps<'td'> & { readonly pinned?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-pinned={pinned ? '' : undefined}
      className={cn('px-2 py-2 align-middle', pinned && PINNED_CELL_CLASS, className)}
      {...props}
    />
  )
}

/**
 * Names the table, and through the container context names the scroll region
 * that holds it. Callers that only need the caption for assistive tech pass
 * `sr-only` — the name still reaches the region.
 */
function TableCaption({ className, id, ...props }: ComponentProps<'caption'>) {
  const captionId = useContext(TableCaptionIdContext)
  return (
    <caption
      data-slot="table-caption"
      id={id ?? captionId}
      className={cn('mt-2 text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  TABLE_LAYER,
}
