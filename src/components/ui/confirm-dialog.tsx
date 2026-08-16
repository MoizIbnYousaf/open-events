import type { ReactNode } from 'react'

import { Button } from './button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'

/**
 * The confirmation step for an action the reader cannot take back.
 *
 * The grammar is fixed on purpose, because a confirmation that varies is a
 * confirmation nobody reads:
 *  - the title names the action and its object ("Publish agenda", "Remove Ada
 *    Lovelace"), never "Are you sure?";
 *  - the description states what happens and, when true, that it cannot be
 *    undone — this is the sentence the reader is actually being asked about;
 *  - Cancel is quiet and sits first, the consequential control sits last and
 *    carries the weight. Cancel is never the styled one.
 *
 * Confirming adds NO request of its own: this component only decides whether
 * the caller's action runs, so a confirm step can never change what the app
 * writes, only whether the reader meant it.
 *
 * `pending` binds to the caller's in-flight state — the confirm button goes
 * inert and `aria-busy` while the action is running, and the dialog stays open
 * until the caller closes it, so a failure is reported over the dialog that
 * caused it rather than behind it.
 *
 * Both buttons go inert through `aria-disabled`, never the native attribute:
 * this dialog deliberately stays open across the request, and a natively
 * disabled control is blurred by the browser the moment it is pressed — which
 * put focus on `<body>`, outside a modal that was still on screen, with
 * `aria-busy` sitting on an element no longer in the tab order. Focus stays on
 * the button the reader pressed for the whole in-flight window, and the close
 * (on server success, from the caller) returns it to whatever opened the
 * dialog, which is Base UI's own focus restore.
 *
 * TWO RUNGS OF THIS LADDER ARE DELIBERATELY NOT BUILT. R12 specifies a consent
 * checkbox ("I understand this cannot be undone") and a type-to-confirm field
 * above the ordinary confirm, for destruction that cascades. Nothing in the
 * product can reach them: no surface has a remove control whose blast radius
 * warrants a rung above "name the action, name the cascade, ask" — the
 * taxonomy editor saves by full replacement and offers no row removal, and the
 * removals that do exist (a co-speaker, a placement, a draft's unsaved edits)
 * each undo one thing the reader can put back. They are recorded here rather
 * than left as a silent gap, because the gap is a decision.
 *
 * REACTIVATION TRIGGER: the first control that deletes a row other rows depend
 * on — a taxonomy remove, an event delete, a bulk action over selected
 * submissions. That is the moment this ladder grows a rung, and the moment
 * C0 §8's "friction scales with blast radius" stops being satisfied by one
 * question.
 *
 * `children` is that report's home: an optional slot between the description
 * and the buttons where the caller mounts its own `StatusLive`/`AlertLive`.
 * It exists because the alternative does not work — a live region left on the
 * page underneath a modal is inside `aria-hidden` subtree while the dialog is
 * open, so the failure that kept the dialog open is announced to nobody and
 * seen by nobody. Putting the caller's region here keeps the one-live-region
 * rule intact (the caller still owns exactly one) and keeps the message where
 * the reader already is. Callers with nothing to report pass nothing, and the
 * dialog renders exactly as it did before.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  pending = false,
  tone = 'destructive',
  children,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  readonly description: ReactNode
  readonly confirmLabel: string
  readonly cancelLabel?: string
  readonly onConfirm: () => void
  readonly pending?: boolean
  /** `destructive` for anything that removes; `default` for sends and publishes. */
  readonly tone?: 'destructive' | 'default'
  /**
   * Status slot rendered inside the dialog body, below the description and
   * above the buttons — the place for the caller's live region when a confirm
   * can fail.
   */
  readonly children?: ReactNode
}) {
  return (
    // A dismissal in flight is ignored, not obeyed. Escape and a backdrop click
    // are the two ways to leave a dialog without answering it, and this one
    // deliberately stays open across the request — so a dismissal mid-flight
    // closed the surface that owns the outcome and left the reader with a
    // request they could no longer see fail. Both buttons are already inert
    // while pending; this is the third exit, and it goes inert with them.
    <Dialog open={open} onOpenChange={(next) => (next || !pending) && onOpenChange(next)}>
      <DialogContent data-slot="confirm-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children !== undefined && children !== null && (
          <div data-slot="confirm-dialog-status">{children}</div>
        )}
        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="ghost"
                type="button"
                disabled={pending}
                // Same reason as the confirm button: a natively disabled
                // control is blurred by the browser, and focus leaving an open
                // modal is worse than a Cancel that refuses to fire.
                focusableWhenDisabled={pending}
              />
            }
            data-slot="confirm-dialog-cancel"
          >
            {cancelLabel}
          </DialogClose>
          <Button
            type="button"
            data-slot="confirm-dialog-confirm"
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            pending={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog }
