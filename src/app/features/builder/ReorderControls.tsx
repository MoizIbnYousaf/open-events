import { Button } from '../../../components/ui/button'
import { ChevronDownIcon, ChevronUpIcon } from '../../../components/ui/icons'

interface ReorderControlsProps {
  readonly canMoveUp: boolean
  readonly canMoveDown: boolean
  readonly onMoveUp: () => void
  readonly onMoveDown: () => void
}

/**
 * Quiet by default and legible on demand: reordering is a background chore
 * next to writing the question, so the controls sit at ghost weight and only
 * gain a fill on hover or focus. The text labels stay — an arrow alone would
 * make the move direction guesswork for anyone reading the buttons aloud.
 *
 * Both controls keep their tab stop at the boundary. Reordering is done by
 * pressing the same button repeatedly, so the press that lands an element at
 * the end is the press that disables the control the reader is standing on —
 * and the browser blurs a natively disabled element, dropping focus to <body>
 * exactly when the reader has finished the job. `focusableWhenDisabled` is the
 * primitive's sanctioned opt-in for that: the control announces as disabled and
 * refuses to fire, but the reader keeps their place and can Tab or Shift-Tab to
 * the other direction from where they already are.
 *
 * `data-icon` belongs on the GLYPH, not on the control: `Button`'s size recipe
 * reads it through `has-data-[icon=inline-start]`, which matches a descendant.
 * Carried on the button itself the attribute matched nothing, so the leading
 * padding never tightened for the icon (shadscan/button-icons-have-data-icon).
 */
export default function ReorderControls({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: ReorderControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canMoveUp}
        focusableWhenDisabled={true}
        onClick={onMoveUp}
      >
        <ChevronUpIcon data-icon="inline-start" />
        Move up
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canMoveDown}
        focusableWhenDisabled={true}
        onClick={onMoveDown}
      >
        <ChevronDownIcon data-icon="inline-start" />
        Move down
      </Button>
    </div>
  )
}
