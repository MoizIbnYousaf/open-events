import { Button } from '../../../components/ui/button'

interface ReorderControlsProps {
  readonly canMoveUp: boolean
  readonly canMoveDown: boolean
  readonly onMoveUp: () => void
  readonly onMoveDown: () => void
}

export default function ReorderControls({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: ReorderControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!canMoveUp} onClick={onMoveUp}>
        Move up
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canMoveDown}
        onClick={onMoveDown}
      >
        Move down
      </Button>
    </div>
  )
}
