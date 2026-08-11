import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { getApiErrorMessage } from '../../api/admin-events'
import {
  useAcceptSubmission,
  useAcceptancePreview,
  useReminderPreview,
  useSendAcceptance,
  useSendReminder,
  useSubmissionMessages,
} from '../../queries/admin-communications'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { SectionHeading } from '../../../components/ui/section-heading'
import type { SubmissionId } from '../../../domain'
import { formatInstant } from './format-instant'

interface CommunicationsPanelProps {
  readonly slug: string
  readonly submissionId: SubmissionId
}

/** How a send is described before it happens, in recipients rather than rows. */
function recipientCount(count: number): string {
  return count === 1 ? '1 recipient' : `${count} recipients`
}

/**
 * Organizer acceptance panel: the acceptance decision itself, the rendered
 * acceptance message, a single real send, and the immutable send history.
 *
 * The two halves are one flow — the API refuses to send an acceptance message
 * for a submission with no acceptance record — so the send stays disabled
 * until the acceptance exists. Every disabled state is derived from persisted
 * server state (the acceptance record and the send history), never from local
 * optimism.
 */
export default function CommunicationsPanel({ slug, submissionId }: CommunicationsPanelProps) {
  const preview = useAcceptancePreview(slug, submissionId)
  const reminderPreview = useReminderPreview(slug, submissionId)
  const messages = useSubmissionMessages(slug, submissionId)
  const accept = useAcceptSubmission(slug, submissionId)
  const send = useSendAcceptance(slug, submissionId)
  const sendReminder = useSendReminder(slug, submissionId)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  /**
   * Where focus lands when the control that had it stops being pressable.
   *
   * Every action in this panel replaces its own trigger on success: accepting
   * swaps the Accept button for the "Acceptance recorded" line, and both sends
   * leave their trigger permanently disabled once the mail is out — so the
   * confirm dialog handed focus back to a control the browser then blurred, and
   * a keyboard reader landed on <body> with the page's place lost. The panel
   * heading is always mounted and is a landing place, not another action (the
   * TasksPanel choreography).
   */
  const landOnHeading = () => headingRef.current?.focus()

  const isLoading = preview.isPending || messages.isPending
  const loadError = preview.error ?? messages.error

  async function retry(): Promise<void> {
    await Promise.all([preview.refetch(), messages.refetch()])
  }

  return (
    <section
      aria-labelledby="communications-heading"
      aria-busy={isLoading || undefined}
      className="flex flex-col gap-3"
    >
      <SectionHeading
        id="communications-heading"
        ref={headingRef}
        tabIndex={-1}
        className="outline-hidden"
      >
        Acceptance
      </SectionHeading>

      {/*
        A stable region whose text changes, not a region created together with
        its text: a live region has to already be in the accessibility tree
        when its content arrives. aria-busy stays on the section being
        populated — on the region it tells assistive tech to suppress the very
        announcement it was added for.
      */}
      <StatusLive aria-live="polite">
        {isLoading ? 'Loading acceptance communications…' : null}
      </StatusLive>
      {isLoading ? (
        // The shape the panel is about to take, so the card does not jump when
        // the two queries land.
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : loadError !== null ? (
        <div className="flex flex-col items-start gap-2">
          <AlertLive>
            {getApiErrorMessage(loadError, 'Acceptance communications could not be loaded.')}
          </AlertLive>
          <Button
            type="button"
            variant="outline"
            pending={preview.isFetching || messages.isFetching}
            onClick={() => {
              void retry()
            }}
          >
            {preview.isFetching || messages.isFetching ? 'Trying again…' : 'Try again'}
          </Button>
        </div>
      ) : (
        <CommunicationsBody
          messages={messages.data ?? []}
          preview={preview.data}
          onAccept={() => {
            // No announcement here. The acceptance chip below flips from
            // "Not accepted yet" to "Acceptance recorded" and is itself a live
            // region, so it speaks the outcome; the failure renders its own
            // role=alert. One region per outcome (DEC-014, F-R3-13).
            accept.mutate(undefined, { onSuccess: landOnHeading })
          }}
          acceptError={accept.error}
          isAccepting={accept.isPending}
          onSend={(onSent) => {
            send.mutate(undefined, {
              // A toast: sending is the last thing an organizer does on this
              // submission, and they leave for the next one immediately. The
              // send history below is still the durable record — it just only
              // appears once the messages query refetches, which is why this
              // outcome needed a channel of its own (DEC-019). The failure
              // does not get one; it has its own alert. No announce() beside
              // it: the toaster's region already speaks this once (DEC-014).
              onSuccess: () => {
                onSent()
                landOnHeading()
                toast.success('Acceptance sent')
              },
            })
          }}
          sendError={send.error}
          isSending={send.isPending}
          reminderAlreadySent={reminderPreview.data?.alreadySent === true}
          onSendReminder={(onSent) => {
            sendReminder.mutate(undefined, {
              // Same channel decision as the acceptance send (DEC-019/DEC-014).
              onSuccess: () => {
                onSent()
                landOnHeading()
                toast.success('Reminder sent')
              },
            })
          }}
          reminderError={sendReminder.error}
          isSendingReminder={sendReminder.isPending}
        />
      )}
    </section>
  )
}

interface CommunicationsBodyProps {
  readonly preview:
    | {
        readonly toEmail: string
        readonly subject: string
        readonly body: string
        readonly accepted: boolean
        readonly audience?: readonly { readonly email: string; readonly alreadySent: boolean }[]
      }
    | undefined
  readonly messages: readonly {
    readonly id: string
    readonly subject: string
    readonly createdAt: string
    readonly kind?: string
    readonly toEmail?: string
  }[]
  readonly onAccept: () => void
  readonly acceptError: unknown
  readonly isAccepting: boolean
  /** `onSent` closes the confirmation, and only the server's answer calls it. */
  readonly onSend: (onSent: () => void) => void
  readonly sendError: unknown
  readonly isSending: boolean
  readonly reminderAlreadySent: boolean
  readonly onSendReminder: (onSent: () => void) => void
  readonly reminderError: unknown
  readonly isSendingReminder: boolean
}

function CommunicationsBody({
  preview,
  messages,
  onAccept,
  acceptError,
  isAccepting,
  onSend,
  sendError,
  isSending,
  reminderAlreadySent,
  onSendReminder,
  reminderError,
  isSendingReminder,
}: CommunicationsBodyProps) {
  // Pre-0012 rows carry no kind on the wire only in stale caches; the server
  // always sends one now, so a missing kind counts as an acceptance row.
  const alreadySent = messages.some((message) => (message.kind ?? 'acceptance') === 'acceptance')
  const accepted = preview?.accepted === true
  const [confirmSend, setConfirmSend] = useState(false)
  const [confirmReminder, setConfirmReminder] = useState(false)
  const audience = preview?.audience ?? []
  const audienceSize = audience.length > 0 ? audience.length : 1
  const audienceNames =
    audience.length > 0
      ? audience.map((recipient) => recipient.email).join(', ')
      : (preview?.toEmail ?? '')

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {accepted ? (
          <StatusLive aria-live="polite">Acceptance recorded</StatusLive>
        ) : (
          <>
            <StatusLive aria-live="polite">Not accepted yet</StatusLive>
            <Button
              type="button"
              pending={isAccepting}
              disabled={preview === undefined}
              onClick={onAccept}
            >
              {isAccepting ? 'Accepting…' : 'Accept proposal'}
            </Button>
            {/* The in-flight state beside the control, not only on it: a
                disabled button's aria-busy is not reliably announced. A stable
                region whose text changes, never one created together with its
                text — a live region has to be in the accessibility tree before
                its content arrives. */}
            <StatusLive aria-live="polite">
              {isAccepting ? 'Accepting this proposal…' : null}
            </StatusLive>
          </>
        )}
      </div>

      {acceptError !== null && acceptError !== undefined ? (
        <AlertLive>
          {getApiErrorMessage(acceptError, 'The proposal could not be accepted.')}
        </AlertLive>
      ) : null}

      {preview === undefined ? (
        <p className="text-sm text-muted-foreground">
          No acceptance message can be rendered for this submission yet.
        </p>
      ) : (
        <dl className="flex flex-col divide-y divide-border rounded-lg text-sm ring-1 ring-border">
          <div className="flex flex-col gap-1 p-3">
            <dt className="text-xs font-medium text-muted-foreground">Recipient</dt>
            <dd className="break-words">{preview.toEmail}</dd>
          </div>
          {preview.audience !== undefined && preview.audience.length > 0 ? (
            <div className="flex flex-col gap-1 p-3">
              <dt
                className="text-xs font-medium text-muted-foreground"
                id="communications-audience"
              >
                Audience
              </dt>
              <dd>
                <ul aria-labelledby="communications-audience" className="flex flex-col gap-1">
                  {preview.audience.map((recipient) => (
                    <li key={recipient.email} className="break-words">
                      {recipient.email}
                      {recipient.alreadySent ? (
                        <span className="text-muted-foreground"> — sent</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          <div className="flex flex-col gap-1 p-3">
            <dt className="text-xs font-medium text-muted-foreground">Subject</dt>
            <dd className="font-medium break-words">{preview.subject}</dd>
          </div>
          <div className="flex flex-col gap-1 p-3">
            <dt className="text-xs font-medium text-muted-foreground">Message</dt>
            <dd>
              {/* The message as it will be read, quoted rather than boxed: a
                  left rule marks it as someone else's words without building a
                  second card inside this one. */}
              <pre className="border-l-2 border-border pl-3 text-[15px] leading-relaxed whitespace-pre-wrap font-sans">
                {preview.body}
              </pre>
            </dd>
          </div>
        </dl>
      )}

      {sendError !== null && sendError !== undefined ? (
        <AlertLive>{getApiErrorMessage(sendError, 'The acceptance could not be sent.')}</AlertLive>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          pending={isSending}
          disabled={alreadySent || !accepted || preview === undefined}
          onClick={() => setConfirmSend(true)}
        >
          {isSending ? 'Sending acceptance…' : 'Send acceptance'}
        </Button>
        {/* The in-flight state beside the control, not only on it: a disabled
            button's aria-busy is not reliably announced. A stable region whose
            text changes, never one created together with its text — a live
            region has to be in the accessibility tree before its content
            arrives. */}
        <StatusLive aria-live="polite">{isSending ? 'Sending the acceptance…' : null}</StatusLive>
        {/* Not a live region: the send is announced once, by the announcer the
            toast speaks through, and a second region carrying the same
            sentence says it twice (DEC-014). This is the label that stays. */}
        {alreadySent ? (
          <span className="text-sm text-muted-foreground">Acceptance sent</span>
        ) : null}
      </div>

      {/* Real mail leaves the building the moment this resolves, and no product
          can recall it — so the ask names who receives it and how many.

          A failure keeps the dialog open and is repeated inside it: the panel's
          alert is the one live region that speaks it (DEC-014), and this
          sentence is what a sighted reader sees, because the alert itself sits
          behind the very dialog that caused it. */}
      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        tone="default"
        title="Send the acceptance email"
        description={`This sends the acceptance above to ${recipientCount(audienceSize)}: ${audienceNames}. Email cannot be recalled once it has been sent.${
          sendError === null || sendError === undefined
            ? ''
            : ' The last attempt failed: the acceptance could not be sent.'
        }`}
        confirmLabel="Send the email"
        pending={isSending}
        onConfirm={() => onSend(() => setConfirmSend(false))}
      />

      {/* Static copy: a 5xx body is server internals, not organizer guidance. */}
      {reminderError !== null && reminderError !== undefined ? (
        <AlertLive>The reminder could not be sent.</AlertLive>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          pending={isSendingReminder}
          disabled={reminderAlreadySent || !accepted || preview === undefined}
          onClick={() => setConfirmReminder(true)}
        >
          {isSendingReminder ? 'Sending reminder…' : 'Send reminder'}
        </Button>
        {/* Same stable-region rule as the acceptance send. */}
        <StatusLive aria-live="polite">
          {isSendingReminder ? 'Sending the reminder…' : null}
        </StatusLive>
        {reminderAlreadySent ? (
          <span className="text-sm text-muted-foreground">Reminder sent</span>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmReminder}
        onOpenChange={setConfirmReminder}
        tone="default"
        title="Send the reminder email"
        description={`This sends a reminder about the outstanding speaker tasks to ${recipientCount(audienceSize)}: ${audienceNames}. Email cannot be recalled once it has been sent.${
          reminderError === null || reminderError === undefined
            ? ''
            : ' The last attempt failed: the reminder could not be sent.'
        }`}
        confirmLabel="Send the email"
        pending={isSendingReminder}
        onConfirm={() => onSendReminder(() => setConfirmReminder(false))}
      />

      <div className="flex flex-col gap-2">
        <h3
          className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
          id="communications-history"
        >
          Send history
        </h3>
        {messages.length > 0 ? (
          <ul
            aria-labelledby="communications-history"
            className="flex flex-col divide-y divide-border rounded-lg text-sm ring-1 ring-border"
          >
            {messages.map((message) => (
              <li key={message.id} className="flex flex-col gap-0.5 p-3">
                <span className="font-medium break-words">{message.subject}</span>
                <span className="text-xs text-muted-foreground">
                  {(message.kind ?? 'acceptance') === 'reminder' ? 'Reminder' : 'Acceptance'}
                  {message.toEmail !== undefined ? ` — ${message.toEmail}` : null}
                </span>
                {/* The machine instant stays on `dateTime`, where a machine
                    reads it; the words are for the organizer, who was being
                    handed a raw ISO-8601 string with a `T` and a `Z` as the
                    log of mail they had just sent. */}
                <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
                  {formatInstant(message.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No acceptance message sent yet.</p>
        )}
      </div>
    </>
  )
}
