import { ConfirmDialog } from '../../../components/ui/confirm-dialog'

/**
 * The confirm step for the two review-round transitions, in one place because
 * the organizer can make either of them from two different surfaces — the
 * submission's committee panel and the event's committee page — and a question
 * that is worded differently depending on where it was asked is a question
 * nobody reads.
 *
 * Lane-local on purpose: this is copy about review rounds, not a new UI
 * primitive. It configures `ConfirmDialog` and adds nothing to it.
 *
 * Closing is the one-way half. It freezes the criteria weights the round was
 * scored with — that snapshot is what keeps a published conclusion from being
 * rewritten by the next round's rubric — and there is no reopen: the only way
 * forward from a closed round is a new one with the next number.
 */
export default function RoundConfirmDialog({
  open,
  onOpenChange,
  kind,
  number,
  pending = false,
  failed = false,
  onConfirm,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly kind: 'open' | 'close'
  readonly number: number
  readonly pending?: boolean
  /** Appends the failure to the question, so the retry is asked over its cause. */
  readonly failed?: boolean
  readonly onConfirm: () => void
}) {
  const failure =
    failed && kind === 'close'
      ? ' The last attempt failed: the round could not be closed.'
      : failed
        ? ' The last attempt failed: the round could not be opened.'
        : ''
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone={kind === 'close' ? 'destructive' : 'default'}
      title={kind === 'close' ? `Close round ${number}` : `Open round ${number}`}
      description={
        kind === 'close'
          ? `Round ${number} stops taking ratings and freezes the criteria weights it was scored with. A closed round cannot be reopened — the way on is a new round.${failure}`
          : `Round ${number} starts taking ratings, and every evaluator assigned from now on scores in it. Its result becomes the one the committee reads as current.${failure}`
      }
      confirmLabel={kind === 'close' ? 'Confirm close' : 'Confirm open'}
      pending={pending}
      onConfirm={onConfirm}
    />
  )
}
