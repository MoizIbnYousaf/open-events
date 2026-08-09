import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'

interface PublishConfirmDialogProps {
  readonly open: boolean
  readonly version: number
  readonly pending: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export default function PublishConfirmDialog({
  open,
  version,
  pending,
  onConfirm,
  onCancel,
}: PublishConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Publish Version {version}</DialogTitle>
          <DialogDescription>
            Publishing makes this version frozen and publicly available.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} aria-label="Confirm publish" onClick={onConfirm}>
            {pending ? 'Publishing…' : 'Confirm publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
