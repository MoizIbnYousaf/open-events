import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { Button } from '../../../components/ui/button'
import { Kbd } from '../../../components/ui/kbd'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../components/ui/command'
import { useTheme } from '../../../components/ui/theme-provider'
import { isEditableTarget } from '../../lib/editable-target'
import { isApplePlatform } from '../../../lib/platform'
import {
  commandActions,
  filterCommandActions,
  groupCommandActions,
  type CommandAction,
  type NavigateCommand,
} from './command-actions'

/**
 * Fired on `window` to open the palette from a visible control (the topbar
 * search button). The chord path stays untouched; this is an additive door.
 */
export const COMMAND_MENU_OPEN_EVENT = 'speakerops:command-menu-open'

/**
 * The `data-tour` value the site toolbar's palette button carries. Exported so
 * the toolbar and the focus-restore lookup below name the same element through
 * one constant; `features/tour/tour-steps.ts` targets the same value.
 */
export const PALETTE_TRIGGER_TOUR_TARGET = 'palette-trigger'

/**
 * Whether an element can actually receive focus on screen right now.
 *
 * The palette has TWO doors, and at any given width exactly one of them is
 * rendered: the toolbar button from `sm` up, the floating button below it. The
 * hidden one is `display: none`, which is a perfectly good ref and a useless
 * focus target — handing it to Base UI's focus restore is how a closed palette
 * dropped its reader on `<body>`. Layout is not consulted (`getClientRects` is
 * empty in jsdom, where these paths are tested); the computed box is enough to
 * tell a rendered control from a folded-away one.
 */
function canTakeFocus(node: unknown): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false
  if (!node.isConnected || node.hidden) return false
  if (node === node.ownerDocument.body) return false
  const style = node.ownerDocument.defaultView?.getComputedStyle(node)
  if (style === undefined) return true
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/**
 * The site toolbar's palette button, looked up rather than held in a ref: it
 * belongs to the shell, not to this component, and it outlives every route.
 *
 * Module scope on purpose. As a `useCallback` it was a fresh binding every
 * render as far as any reader (or checker) could tell, which made
 * `rememberFinalFocus` look unstable and the chord effect look like it
 * re-subscribed on every parent redraw
 * (react-doctor/prefer-use-effect-event). It reads no props and no state, so
 * it was never a hook's business.
 */
function toolbarTrigger(): Element | null {
  return document.querySelector(`[data-tour="${PALETTE_TRIGGER_TOUR_TARGET}"]`)
}

const OPEN_HINT_MAC = '⌘K'
const OPEN_HINT_OTHER = 'Ctrl+K'
const THEME_HINT_MAC = '⇧⌘L'
const THEME_HINT_OTHER = 'Ctrl+⇧+L'

/**
 * Emphasises the characters a query actually matched, so a partial query shows
 * its own reasoning. Runs are coalesced rather than wrapping every character,
 * which keeps the DOM small and the text selectable as one word.
 */
function highlight(label: string, matched: readonly number[]): ReactNode {
  if (matched.length === 0) return label
  const marks = new Set(matched)
  const parts: ReactNode[] = []
  let buffer = ''
  let bufferMarked = false
  function flush(): void {
    if (buffer === '') return
    parts.push(
      bufferMarked ? (
        <span key={parts.length} className="font-semibold text-foreground">
          {buffer}
        </span>
      ) : (
        buffer
      ),
    )
    buffer = ''
  }
  for (let index = 0; index < label.length; index += 1) {
    const marked = marks.has(index)
    if (marked !== bufferMarked) {
      flush()
      bufferMarked = marked
    }
    buffer += label[index]
  }
  flush()
  return parts
}

/**
 * The app-level command menu.
 *
 * It accelerates the visible navigation rather than replacing it: every
 * destination it offers comes from `nav-model.ts`, the same list the event nav
 * and the speaker/programme navs render, so it can never reach a surface a
 * first-time visitor cannot also reach by looking (DEC-012, DEC-017).
 *
 * Two ways in, because a shortcut nobody can see is not an affordance: the
 * visible button in the site header, and Cmd/Ctrl+K. Both are named in
 * `aria-keyshortcuts` and in the palette's own footer.
 */
interface CommandMenuProps {
  readonly onNavigate: (action: NavigateCommand) => void
  readonly floating?: boolean
}

export function CommandMenu({ onNavigate, floating = false }: CommandMenuProps): ReactElement {
  const { setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const openRef = useRef(false)
  useEffect(() => {
    openRef.current = open
  }, [open])

  /**
   * Where focus goes when the palette closes.
   *
   * Base UI reads this on close, so it has to name something that is on screen
   * THEN — and this component's own button is the wrong answer at most widths,
   * because it is the phone's door and is `display: none` from `sm` up. It is
   * resolved at open time instead, from the first candidate that can actually
   * take focus: whatever opened the palette, then this component's button,
   * then the toolbar's. So a reader who pressed the chord from a rail link
   * lands back on that link, and one who pressed it from nowhere lands on the
   * visible trigger rather than on `<body>`.
   */
  const finalFocusRef = useRef<HTMLElement | null>(null)

  const rememberFinalFocus = useCallback(() => {
    const candidates: readonly unknown[] = [
      document.activeElement,
      triggerRef.current,
      toolbarTrigger(),
    ]
    finalFocusRef.current = candidates.find(canTakeFocus) ?? null
  }, [])

  // Declared above the chord handler because that handler closes through it:
  // the dialog is controlled, so driving `open` to false fires no
  // onOpenChange, and a close that skips this leaves the query behind for the
  // next open to filter by.
  const close = useCallback(() => {
    setOpen(false)
    setSearch('')
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // A modifier chord only, inert while composing, on key repeat, or once
      // something else has consumed the event. preventDefault is called only
      // on the path that acts.
      if (event.defaultPrevented || event.repeat || event.isComposing) return
      if (event.altKey || event.shiftKey) return
      // One condition because it is one chord: the modifier and the key are
      // never meaningful apart, and splitting them leaves a bare-key test
      // sitting on its own that a later edit can reach past.
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      // Closing comes first, and unconditionally: while the palette is open
      // its own search box IS the editable target, and the chord that opened
      // it has to be able to put it away again.
      if (openRef.current) {
        event.preventDefault()
        close()
        return
      }
      // Ctrl+K deletes to the end of the line in macOS text controls, so the
      // palette never takes the chord away from a field being typed into.
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      rememberFinalFocus()
      setOpen(true)
    }
    function onOpenEvent(): void {
      if (openRef.current) return
      rememberFinalFocus()
      setOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener(COMMAND_MENU_OPEN_EVENT, onOpenEvent)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(COMMAND_MENU_OPEN_EVENT, onOpenEvent)
    }
  }, [close, rememberFinalFocus])

  const actions = useMemo(() => commandActions(), [])
  const matches = useMemo(() => filterCommandActions(actions, search), [actions, search])
  const groups = useMemo(() => groupCommandActions(matches), [matches])
  // Rendered order, not filter order: the groups are drawn in a fixed order of
  // their own, and the arrow keys have to walk the list the eye sees.
  const values = useMemo(
    () => groups.flatMap((group) => group.items.map((action) => action.id)),
    [groups],
  )

  const run = useCallback(
    (action: CommandAction) => {
      // A navigating close lands on a page the opener may not survive — a rail
      // link on the route being left is unmounted before Base UI restores. The
      // shell's own trigger outlives every route, so that is where a reader
      // who navigated is put down.
      if (action.kind === 'navigate') {
        const trigger = [triggerRef.current, toolbarTrigger()].find(canTakeFocus)
        if (trigger !== undefined) finalFocusRef.current = trigger
      }
      close()
      if (action.kind === 'theme') {
        setTheme(action.preference)
        return
      }
      onNavigate(action)
    },
    [close, onNavigate, setTheme],
  )

  const apple = isApplePlatform()

  const menu = (
    <>
      {/* When it floats it is the phone's door into the palette, and only
          that: at sm and up the toolbar already carries a visible trigger, and
          two buttons for one dialog is one too many. It gets the overlay halo
          rather than a drop shadow, because it hovers over the page. */}
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="outline"
        className={floating ? 'fixed right-4 bottom-4 z-50 shadow-popover sm:hidden' : undefined}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => {
          rememberFinalFocus()
          setOpen(true)
        }}
      >
        Command menu
        <Kbd>{apple ? OPEN_HINT_MAC : OPEN_HINT_OTHER}</Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true)
          else close()
        }}
        title="Command menu"
        description="Search this event's screens and switch the theme. Use the arrow keys to choose, Enter to go, Escape to close."
        finalFocus={finalFocusRef}
      >
        <Command values={values} search={search} onSearchChange={setSearch}>
          <CommandInput aria-label="Search commands" placeholder="Search commands…" />
          <CommandList aria-label="Commands">
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((action) => (
                  <CommandItem key={action.id} value={action.id} onSelect={() => run(action)}>
                    <span className="min-w-0 truncate">
                      {highlight(action.label, action.matched)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <CommandEmpty>
            {matches.length === 0 ? `No commands match “${search}”.` : null}
          </CommandEmpty>
          {/* The keys this dialog answers to, published where they are used.
              A palette that has to be explained elsewhere is a palette nobody
              drives with the keyboard. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              open
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              close
            </span>
            <span className="flex items-center gap-1.5 sm:ml-auto">
              <Kbd>{apple ? THEME_HINT_MAC : THEME_HINT_OTHER}</Kbd>
              theme
            </span>
          </div>
        </Command>
      </CommandDialog>
    </>
  )

  return menu
}
