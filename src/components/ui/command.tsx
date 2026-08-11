import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'

import { cn } from '../../lib/utils'

/**
 * Command menu primitives.
 *
 * Written against Base UI rather than pulling in `cmdk`: Base UI's Dialog
 * already owns the focus trap, the Escape handling and the focus restore this
 * needs, and adding a second overlay runtime for the rest would be a new
 * dependency for a list, a filter and five key handlers.
 *
 * Deliberately free of imported icon modules. This composition is mounted by
 * the root shell, so it lands in the entry chunk, which `scripts/perf-check.mjs`
 * holds to a gzip budget and greps for third-party icon strings — glyphs here
 * are drawn inline, in file.
 *
 * The pattern is the ARIA combobox-with-listbox one: the text box keeps DOM
 * focus for the whole interaction and points at the active option with
 * `aria-activedescendant`, so typing, filtering and arrowing never move focus
 * and never break the trap.
 */

/** Marks an option in the DOM so Enter can activate exactly what is selected. */
const ITEM_VALUE_ATTRIBUTE = 'data-command-value'

/**
 * The rendered option carrying a value, if one is on screen.
 *
 * One query against the list, which is what activation has always done — a ref
 * on every row would buy nothing here and cost a render's worth of work on a
 * list that is rebuilt on every keystroke.
 */
function optionNode(list: HTMLElement | null, value: string | null): HTMLElement | undefined {
  if (list === null || value === null) return undefined
  return Array.from(list.querySelectorAll<HTMLElement>(`[${ITEM_VALUE_ATTRIBUTE}]`)).find(
    (node) => node.getAttribute(ITEM_VALUE_ATTRIBUTE) === value,
  )
}

interface CommandContextValue {
  readonly activeValue: string | null
  readonly setActiveValue: (value: string | null) => void
  readonly itemId: (value: string) => string
  readonly listId: string
  readonly search: string
  readonly setSearch: (value: string) => void
  readonly listRef: RefObject<HTMLDivElement | null>
}

const CommandContext = createContext<CommandContextValue | null>(null)

function useCommandContext(): CommandContextValue {
  const value = useContext(CommandContext)
  if (value === null) throw new Error('Command parts must be used inside <Command>')
  return value
}

/**
 * The dialog shell. Base UI restores focus to `finalFocus` on close, which is
 * why the caller passes the visible affordance: the palette is also opened by
 * a keyboard chord, and "wherever focus happened to be" is not a place to
 * return a keyboard user to.
 */
function CommandDialog({
  open,
  onOpenChange,
  title,
  description,
  finalFocus,
  children,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly description: string
  readonly finalFocus?: RefObject<HTMLElement | null>
  readonly children: ReactNode
}): ReactElement {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="command-overlay"
          className="fixed inset-0 z-50 bg-scrim data-closed:animate-out data-closed:animation-duration-75 data-closed:fade-out-0 data-open:animate-in data-open:animation-duration-150 data-open:fade-in-0 motion-reduce:animate-none"
        />
        <DialogPrimitive.Popup
          data-slot="command-dialog"
          finalFocus={finalFocus}
          className="fixed top-[12vh] left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-popover ring-1 ring-border outline-none data-closed:animate-out data-closed:animation-duration-75 data-closed:fade-out-0 data-closed:zoom-out-[0.98] data-open:animate-in data-open:animation-duration-150 data-open:ease-entrance data-open:fade-in-0 data-open:zoom-in-[0.98] motion-reduce:animate-none sm:max-w-lg"
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Holds the query and the active option, and owns the list keystrokes.
 *
 * Filtering itself is the caller's job: the caller knows what a command is and
 * can keep one source of truth for the list, which is the whole point of
 * `nav-model.ts`.
 */
function Command({
  values,
  search,
  onSearchChange,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'onSelect'> & {
  /** The visible option values, in the order they are rendered. */
  readonly values: readonly string[]
  readonly search: string
  readonly onSearchChange: (value: string) => void
}): ReactElement {
  const baseId = useId()
  const listRef = useRef<HTMLDivElement | null>(null)
  const [preferred, setPreferred] = useState<string | null>(null)

  // Derived, never stored: the visible set changes with every keystroke, and a
  // remembered active value that has just been filtered away would leave
  // aria-activedescendant pointing at a node that no longer exists. Falling
  // back to the first option is also what makes Enter work on a fresh query
  // without an arrow key first.
  const activeValue =
    preferred !== null && values.includes(preferred) ? preferred : (values[0] ?? null)

  const itemId = useCallback((value: string) => `${baseId}-item-${value}`, [baseId])

  /**
   * Move the highlight, and keep the highlight on screen.
   *
   * The list is capped at 24rem — about a dozen rows — and the palette already
   * offers more actions than that with an empty query, so arrowing past the
   * fold used to move a highlight nobody could see: `aria-activedescendant`
   * kept announcing it, and the sighted keyboard reader simply lost it.
   *
   * `block: 'nearest'` is the whole reason this is safe to do on every press —
   * a row already in view does not move the scroller at all, so the list stays
   * still until it has to move. No `behavior` is passed, deliberately: an
   * explicit `smooth` OVERRIDES the element's computed `scroll-behavior`, which
   * would animate straight through the global reduced-motion guard.
   *
   * Optional call because jsdom does not implement `scrollIntoView`.
   *
   * Pointer hover still goes through `setPreferred` directly: the pointer is
   * already where the reader is looking, and scrolling under it would drag the
   * list out from beneath the cursor.
   */
  const moveTo = useCallback((value: string | null) => {
    setPreferred(value)
    optionNode(listRef.current, value)?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  const move = useCallback(
    (delta: number) => {
      if (values.length === 0) return
      const current = activeValue === null ? -1 : values.indexOf(activeValue)
      const next = current < 0 ? 0 : (current + delta + values.length) % values.length
      moveTo(values[next] ?? null)
    },
    [activeValue, moveTo, values],
  )

  const jump = useCallback(
    (toEnd: boolean) => {
      if (values.length === 0) return
      moveTo((toEnd ? values[values.length - 1] : values[0]) ?? null)
    },
    [moveTo, values],
  )

  const runActive = useCallback(() => {
    optionNode(listRef.current, activeValue)?.click()
  }, [activeValue])

  const value = useMemo<CommandContextValue>(
    () => ({
      activeValue,
      setActiveValue: setPreferred,
      itemId,
      listId: `${baseId}-list`,
      search,
      setSearch: onSearchChange,
      listRef,
    }),
    [activeValue, baseId, itemId, onSearchChange, search],
  )

  return (
    <CommandContext.Provider value={value}>
      <div
        data-slot="command"
        className={cn('flex flex-col', className)}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            move(1)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            move(-1)
            return
          }
          if (event.key === 'Home') {
            event.preventDefault()
            jump(false)
            return
          }
          if (event.key === 'End') {
            event.preventDefault()
            jump(true)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            runActive()
            return
          }
          // Escape is a two-rung ladder: with a query it retreats one step —
          // clear the query, keep the palette open — and only on an empty
          // query does it fall through to the surrounding dialog, which owns
          // the close key because it also has to restore focus. Consuming
          // every Escape here would take that away; consuming none would make
          // a mistyped query cost the whole palette.
          if (event.key === 'Escape' && search !== '') {
            event.preventDefault()
            event.stopPropagation()
            onSearchChange('')
          }
        }}
        {...props}
      >
        {children}
      </div>
    </CommandContext.Provider>
  )
}

function CommandInput({ className, ...props }: ComponentProps<'input'>): ReactElement {
  const { activeValue, itemId, listId, search, setSearch } = useCommandContext()
  return (
    <input
      data-slot="command-input"
      type="text"
      role="combobox"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      aria-expanded={true}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={activeValue === null ? undefined : itemId(activeValue)}
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      className={cn(
        'h-11 w-full border-b border-border bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground md:text-sm',
        // The focus indicator is the SEPARATOR, promoted — not a ring.
        //
        // A ring is a boundary drawn around a control to separate it from the
        // things it is not. This control has no such neighbours: it is flush
        // with three edges of a popup that clips its overflow, so a 2px ring
        // survived only along the bottom and rendered as a saturated blue rule
        // spanning the dialog — a design element the design never asked for.
        //
        // Dropping the indicator entirely was the wrong correction: a focusable
        // control has to say so, and this box takes every keystroke in the
        // palette. So the hairline it already needs — the one separating it
        // from the list below — takes the accent and thickens to 2px while the
        // box holds focus. The extra pixel is an INSET shadow, so it is drawn
        // inside the border box: no overflow to clip, no bleed past the popup's
        // edges, and no layout shift when it appears.
        'focus-visible:border-ring focus-visible:shadow-[inset_0_-1px_0_0_var(--color-ring)]',
        className,
      )}
      {...props}
    />
  )
}

function CommandList({ className, ...props }: ComponentProps<'div'>): ReactElement {
  const { listId, listRef } = useCommandContext()
  return (
    <div
      ref={listRef}
      id={listId}
      data-slot="command-list"
      role="listbox"
      // Chrome makes a scrollable box focusable, which put a second tab stop
      // inside a two-stop dialog — and standing on it was strictly worse than
      // standing in the input: same arrow keys, but `aria-activedescendant`
      // lives on the input, so the highlighted option was announced to nobody.
      // The combobox pattern keeps focus in the text box; this takes itself
      // out of the tab order to keep that promise.
      tabIndex={-1}
      className={cn(
        'max-h-[min(24rem,60vh)] scroll-py-1 overflow-y-auto overscroll-contain p-1',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A stable region whose text changes, never a region created together with its
 * text: a polite live region has to be in the accessibility tree before its
 * content arrives or the "no results" is silent.
 */
function CommandEmpty({ className, ...props }: ComponentProps<'p'>): ReactElement {
  return (
    <p
      data-slot="command-empty"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn('px-3 py-6 text-center text-sm text-muted-foreground empty:hidden', className)}
      {...props}
    />
  )
}

function CommandGroup({
  heading,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { readonly heading: string }): ReactElement {
  const headingId = useId()
  return (
    <div
      data-slot="command-group"
      role="group"
      aria-labelledby={headingId}
      className={cn('pb-1 not-first:pt-1', className)}
      {...props}
    >
      <div
        id={headingId}
        className="px-2 pt-1.5 pb-1 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
      >
        {heading}
      </div>
      {children}
    </div>
  )
}

/**
 * A real `<button>` under the option role, not a clickable div: the element is
 * operable by pointer, by Enter from the search box, and by Enter or Space if
 * anything ever moves focus onto it. `tabIndex={-1}` keeps it out of the tab
 * order because the combobox pattern keeps focus in the text box.
 */
function CommandItem({
  value,
  className,
  children,
  onSelect,
  ...props
}: Omit<ComponentProps<'button'>, 'onSelect' | 'value'> & {
  readonly value: string
  readonly onSelect: () => void
}): ReactElement {
  const { activeValue, setActiveValue, itemId } = useCommandContext()
  const active = activeValue === value
  return (
    <button
      type="button"
      data-slot="command-item"
      {...{ [ITEM_VALUE_ATTRIBUTE]: value }}
      id={itemId(value)}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onClick={onSelect}
      onPointerMove={() => setActiveValue(value)}
      className={cn(
        'flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-[5px] px-2 text-left text-sm font-medium outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
        // Pointer hover and keyboard selection are ONE state: the row the
        // arrow keys landed on and the row under the cursor must never be two
        // different rows, or Enter becomes a guess.
        active ? 'bg-foreground/5 text-foreground dark:bg-foreground/10' : 'text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
}
