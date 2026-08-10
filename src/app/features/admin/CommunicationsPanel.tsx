import { getApiErrorMessage } from '../../api/admin-events'
import {
  useAcceptancePreview,
  useSendAcceptance,
  useSubmissionMessages,
} from '../../queries/admin-communications'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { StatusLive } from '../../../components/ui/status-live'
import type { SubmissionId } from '../../../domain'

interface CommunicationsPanelProps {
  readonly submissionId: SubmissionId
}

/**
 * Organizer acceptance panel: the rendered acceptance message, a single real
 * send, and the immutable send history. The send button's disabled state is
 * derived from the persisted history — never from local optimism.
 */
export default function CommunicationsPanel({ submissionId }: CommunicationsPanelProps) {
  const preview = useAcceptancePreview(submissionId)
  const messages = useSubmissionMessages(submissionId)
  const send = useSendAcceptance(submissionId)

  const isLoading = preview.isPending || messages.isPending
  const loadError = preview.error ?? messages.error

  async function retry(): Promise<void> {
    await Promise.all([preview.refetch(), messages.refetch()])
  }

  return (
    <section aria-labelledby="communications-heading" className="flex flex-col gap-4">
      <h2 id="communications-heading" className="text-base font-semibold">
        Acceptance communications
      </h2>

      {isLoading ? (
        <StatusLive aria-busy="true">Loading acceptance communications…</StatusLive>
      ) : loadError !== null ? (
        <div className="flex flex-col items-start gap-2">
          <AlertLive>
            {getApiErrorMessage(loadError, 'Acceptance communications could not be loaded.')}
          </AlertLive>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              void retry()
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <CommunicationsBody
          messages={messages.data ?? []}
          preview={preview.data}
          onSend={() => {
            send.mutate()
          }}
          sendError={send.error}
          isSending={send.isPending}
        />
      )}
    </section>
  )
}

interface CommunicationsBodyProps {
  readonly preview:
    { readonly toEmail: string; readonly subject: string; readonly body: string } | undefined
  readonly messages: readonly {
    readonly id: string
    readonly subject: string
    readonly createdAt: string
  }[]
  readonly onSend: () => void
  readonly sendError: unknown
  readonly isSending: boolean
}

function CommunicationsBody({
  preview,
  messages,
  onSend,
  sendError,
  isSending,
}: CommunicationsBodyProps) {
  const alreadySent = messages.length > 0

  return (
    <>
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
          disabled={alreadySent || isSending || preview === undefined}
          onClick={onSend}
        >
          Send acceptance
        </Button>
        {alreadySent ? <StatusLive>Acceptance sent</StatusLive> : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Send history</h3>
        {alreadySent ? (
          <ul className="flex flex-col gap-2 text-sm">
            {messages.map((message) => (
              <li key={message.id} className="flex flex-col gap-1">
                <span>{message.subject}</span>
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
