import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import { Button } from '../../../components/ui/button'
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

const OPEN_HINT_MAC = '⌘K'
const OPEN_HINT_OTHER = 'Ctrl+K'
const THEME_HINT_MAC = '⇧⌘L'
const THEME_HINT_OTHER = 'Ctrl+⇧+L'

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
      setOpen(true)
    }
    function onOpenEvent(): void {
      if (!openRef.current) setOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener(COMMAND_MENU_OPEN_EVENT, onOpenEvent)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(COMMAND_MENU_OPEN_EVENT, onOpenEvent)
    }
  }, [close])

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
      <Button
        ref={triggerRef}
        type="button"
        size="xs"
        variant="outline"
        className={floating ? 'fixed right-4 bottom-4 z-50 shadow-lg' : undefined}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
      >
        Command menu
        <kbd
          aria-hidden="true"
          className="hidden rounded border border-border px-1 text-[0.65rem] text-muted-foreground sm:inline-flex"
        >
          {apple ? OPEN_HINT_MAC : OPEN_HINT_OTHER}
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true)
          else close()
        }}
        title="Command menu"
        description="Search this event's screens and switch the theme. Use the arrow keys to choose, Enter to go, Escape to close."
        finalFocus={triggerRef}
      >
        <Command values={values} search={search} onSearchChange={setSearch}>
          <CommandInput aria-label="Search commands" placeholder="Search commands…" />
          <CommandList aria-label="Commands">
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((action) => (
                  <CommandItem key={action.id} value={action.id} onSelect={() => run(action)}>
                    {action.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <CommandEmpty>
            {matches.length === 0 ? `No commands match “${search}”.` : null}
          </CommandEmpty>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Theme: {apple ? THEME_HINT_MAC : THEME_HINT_OTHER}
          </p>
        </Command>
      </CommandDialog>
    </>
  )

  return menu
}
