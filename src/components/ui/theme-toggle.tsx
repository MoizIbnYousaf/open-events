import { isApplePlatform } from '../../lib/platform'
import { THEME_LABELS, THEME_PREFERENCES } from '../../lib/theme'
import { Button } from './button'
import { useTheme, useThemePreferenceKeys } from './theme-provider'

const SHORTCUT_HINT_MAC = '⇧⌘D'
const SHORTCUT_HINT_OTHER = 'Ctrl+⇧+D'

/** The primary chord, printed the way the platform writes it. L remains an alias. */
function shortcutHint(): string {
  return isApplePlatform() ? SHORTCUT_HINT_MAC : SHORTCUT_HINT_OTHER
}

/**
 * The visible theme control. Three buttons in a named group rather than a
 * Select: this renders in the root shell on every route, and
 * src/components/ui/select.tsx pulls lucide-react into the entry chunk, which
 * the perf gate budgets against (scripts/perf-check.mjs purity markers).
 *
 * The keyboard chord is discoverable rather than hidden: aria-keyshortcuts
 * carries both chords to assistive tech and the <kbd> carries the primary one
 * to sighted users (DEC-015).
 */
export function ThemeToggle() {
  const { preference, setTheme } = useTheme()
  const onKeyDown = useThemePreferenceKeys()

  return (
    <div
      className="flex items-center gap-1"
      aria-keyshortcuts="Control+Shift+D Meta+Shift+D Control+Shift+L Meta+Shift+L"
    >
      {/* The letters are advertised on the group that handles them, and only
          there: they work when focus is inside this control and nowhere else,
          so naming them page-wide would promise a shortcut the page does not
          have (DEC-020). */}
      <div
        role="group"
        aria-label="Theme"
        aria-keyshortcuts="S L D"
        onKeyDown={onKeyDown}
        className="flex items-center gap-1"
      >
        {THEME_PREFERENCES.map((option) => (
          <Button
            key={option}
            type="button"
            size="xs"
            variant={preference === option ? 'secondary' : 'ghost'}
            aria-pressed={preference === option}
            onClick={() => setTheme(option)}
          >
            {THEME_LABELS[option]}
          </Button>
        ))}
      </div>
      <kbd
        aria-hidden="true"
        className="hidden rounded border border-border px-1 text-[0.65rem] text-muted-foreground sm:inline-flex"
      >
        {shortcutHint()}
      </kbd>
    </div>
  )
}
