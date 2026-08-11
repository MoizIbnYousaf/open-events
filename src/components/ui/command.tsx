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
 * Deliberately free of lucide-react. This composition is mounted by the root
 * shell, so it lands in the entry chunk, and `scripts/perf-check.mjs` fails the
 * build if an icon set reaches it.
 *
 * The pattern is the ARIA combobox-with-listbox one: the text box keeps DOM
 * focus for the whole interaction and points at the active option with
 * `aria-activedescendant`, so typing, filtering and arrowing never move focus
 * and never break the trap.
 */

/** Marks an option in the DOM so Enter can activate exactly what is selected. */
const ITEM_VALUE_ATTRIBUTE = 'data-command-value'

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
          className="fixed inset-0 z-50 bg-black/20 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 motion-reduce:animate-none"
        />
        <DialogPrimitive.Popup
          data-slot="command-dialog"
          finalFocus={finalFocus}
          className="fixed top-[12vh] left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-xl bg-popover text-popover-foreground ring-1 ring-foreground/10 outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 motion-reduce:animate-none sm:max-w-lg"
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

  const move = useCallback(
    (delta: number) => {
      if (values.length === 0) return
      const current = activeValue === null ? -1 : values.indexOf(activeValue)
      const next = current < 0 ? 0 : (current + delta + values.length) % values.length
      setPreferred(values[next] ?? null)
    },
    [activeValue, values],
  )

  const jump = useCallback(
    (toEnd: boolean) => {
      if (values.length === 0) return
      setPreferred((toEnd ? values[values.length - 1] : values[0]) ?? null)
    },
    [values],
  )

  const runActive = useCallback(() => {
    if (activeValue === null || listRef.current === null) return
    const nodes = Array.from(
      listRef.current.querySelectorAll<HTMLElement>(`[${ITEM_VALUE_ATTRIBUTE}]`),
    )
    nodes.find((node) => node.getAttribute(ITEM_VALUE_ATTRIBUTE) === activeValue)?.click()
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
          }
          // Escape is deliberately left alone: the surrounding dialog owns it,
          // and consuming it here would take the close key away from the
          // component that also has to restore focus.
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
        'w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground md:text-sm',
        // The outline is replaced, never removed: this box holds focus for the
        // whole interaction, so it has to look focused.
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
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
      className={cn('max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain p-1', className)}
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
      className={cn('px-4 py-3 text-sm text-muted-foreground empty:hidden', className)}
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
      className={cn('py-1', className)}
      {...props}
    >
      <div id={headingId} className="px-3 py-1 text-xs font-medium text-muted-foreground">
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
        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-muted text-foreground' : 'text-foreground/90',
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
