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
import { announce } from '../../lib/announcer'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { StatusLive } from '../../../components/ui/status-live'
import type { SubmissionId } from '../../../domain'

interface CommunicationsPanelProps {
  readonly slug: string
  readonly submissionId: SubmissionId
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

  const isLoading = preview.isPending || messages.isPending
  const loadError = preview.error ?? messages.error

  async function retry(): Promise<void> {
    await Promise.all([preview.refetch(), messages.refetch()])
  }

  return (
    <section
      aria-labelledby="communications-heading"
      aria-busy={isLoading || undefined}
      className="flex flex-col gap-4"
    >
      <h2 id="communications-heading" className="text-base font-semibold">
        Acceptance
      </h2>

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
      {isLoading ? null : loadError !== null ? (
        <div className="flex flex-col items-start gap-2">
          <AlertLive>
            {getApiErrorMessage(loadError, 'Acceptance communications could not be loaded.')}
          </AlertLive>
          <Button
            type="button"
            variant="outline"
            size="lg"
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
            accept.mutate(undefined, {
              // Only the success is announced. The failure already renders its
              // own role=alert below with the same sentence, and two live
              // regions carrying one message speak it twice (DEC-014).
              onSuccess: () => announce('Proposal accepted'),
            })
          }}
          acceptError={accept.error}
          isAccepting={accept.isPending}
          onSend={() => {
            send.mutate(undefined, {
              // A toast: sending is the last thing an organizer does on this
              // submission, and they leave for the next one immediately. The
              // send history below is still the durable record — it just only
              // appears once the messages query refetches, which is why this
              // outcome needed a channel of its own (DEC-019). The failure
              // does not get one; it has its own alert. No announce() beside
              // it: the toaster's region already speaks this once (DEC-014).
              onSuccess: () => toast.success('Acceptance sent'),
            })
          }}
          sendError={send.error}
          isSending={send.isPending}
          reminderAlreadySent={reminderPreview.data?.alreadySent === true}
          onSendReminder={() => {
            sendReminder.mutate(undefined, {
              // Same channel decision as the acceptance send (DEC-019/DEC-014).
              onSuccess: () => toast.success('Reminder sent'),
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
  readonly onSend: () => void
  readonly sendError: unknown
  readonly isSending: boolean
  readonly reminderAlreadySent: boolean
  readonly onSendReminder: () => void
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
              size="lg"
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
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="font-medium">Recipient</dt>
            <dd>{preview.toEmail}</dd>
          </div>
          {preview.audience !== undefined && preview.audience.length > 0 ? (
            <div className="flex flex-col gap-1">
              <dt className="font-medium" id="communications-audience">
                Audience
              </dt>
              <dd>
                <ul aria-labelledby="communications-audience" className="flex flex-col gap-1">
                  {preview.audience.map((recipient) => (
                    <li key={recipient.email}>
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
          <div className="flex flex-col gap-1">
            <dt className="font-medium">Subject</dt>
            <dd>{preview.subject}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">Message</dt>
            <dd>
              <pre className="whitespace-pre-wrap font-sans">{preview.body}</pre>
            </dd>
          </div>
        </dl>
      )}

      {sendError !== null && sendError !== undefined ? (
        <AlertLive>{getApiErrorMessage(sendError, 'The acceptance could not be sent.')}</AlertLive>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="lg"
          pending={isSending}
          disabled={alreadySent || !accepted || preview === undefined}
          onClick={onSend}
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

      {/* Static copy: a 5xx body is server internals, not organizer guidance. */}
      {reminderError !== null && reminderError !== undefined ? (
        <AlertLive>The reminder could not be sent.</AlertLive>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          pending={isSendingReminder}
          disabled={reminderAlreadySent || !accepted || preview === undefined}
          onClick={onSendReminder}
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

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold" id="communications-history">
          Send history
        </h3>
        {messages.length > 0 ? (
          <ul aria-labelledby="communications-history" className="flex flex-col gap-2 text-sm">
            {messages.map((message) => (
              <li key={message.id} className="flex flex-col gap-1">
                <span>{message.subject}</span>
                <span className="text-muted-foreground">
                  {(message.kind ?? 'acceptance') === 'reminder' ? 'Reminder' : 'Acceptance'}
                  {message.toEmail !== undefined ? ` — ${message.toEmail}` : null}
                </span>
                <time dateTime={message.createdAt} className="text-muted-foreground">
                  {message.createdAt}
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
