import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { StatusLive } from '../../../components/ui/status-live'

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
        {/* The in-flight publish next to the control that started it: the
            dialog stays open until the request settles, so aria-busy on a
            disabled confirm button is on its own not reliably announced. The
            region is mounted with the dialog and its text arrives later — a
            live region created together with its text announces nothing. */}
        <StatusLive aria-live="polite">{pending ? 'Publishing this version…' : null}</StatusLive>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          {/* `pending` is what exposes aria-busy; Cancel stays merely disabled
              because it is not the control that is doing anything. */}
          <Button type="button" pending={pending} aria-label="Confirm publish" onClick={onConfirm}>
            {pending ? 'Publishing…' : 'Confirm publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
