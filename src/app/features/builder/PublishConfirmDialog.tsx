import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import { StatusLive } from '../../../components/ui/status-live'

interface PublishConfirmDialogProps {
  readonly open: boolean
  readonly version: number
  readonly pending: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * The shared confirm grammar, with the one thing publishing adds: it is the
 * only confirmation in the product that reports its own progress, and that
 * report has to live INSIDE the dialog. A live region left on the page behind
 * a modal sits in an aria-hidden subtree, so the sentence that explains why
 * the dialog is still open would be announced to nobody. `ConfirmDialog`'s
 * status slot is exactly that place, so this file no longer respells the
 * dialog it belongs to — only the copy and the region are its own.
 *
 * The region is mounted with the dialog and its text arrives later; a live
 * region created together with its text announces nothing.
 *
 * `tone` stays default rather than destructive: publishing adds a frozen
 * version, it does not take anything away.
 */
export default function PublishConfirmDialog({
  open,
  version,
  pending,
  onConfirm,
  onCancel,
}: PublishConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel()
      }}
      title={`Publish Version ${version}`}
      description="Publishing makes this version frozen and publicly available."
      // Fixed in both states. The label names the ACTION; what is happening is
      // the status region's job below. The old copy swapped the face to
      // "Publishing…" while pinning an aria-label of "Confirm publish" over
      // it — a control that reads one thing and announces another. Holding one
      // string keeps the accessible name stable (asserted while pending) and
      // makes it the visible one again.
      confirmLabel="Confirm publish"
      tone="default"
      pending={pending}
      onConfirm={onConfirm}
    >
      <StatusLive aria-live="polite">{pending ? 'Publishing this version…' : null}</StatusLive>
    </ConfirmDialog>
  )
}
