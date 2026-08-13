import { useEffect, useMemo, useState } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { useMessageLog } from '../../queries/admin-messages'
import type { EventSlug } from '../../../domain'
import type { MessageLogEntryDto } from '../../../application'

const sentAtFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatSentAt(value: string): string {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : `${sentAtFormatter.format(parsed)} UTC`
}

/** Plain words for the stored kind, so a reader is not decoding an identifier. */
function kindLabel(kind: string): string {
  if (kind === 'confirmation') return 'Sign-in link'
  if (kind === 'acceptance') return 'Acceptance'
  if (kind === 'reminder') return 'Reminder'
  return kind
}

/**
 * Everything this event has sent.
 *
 * The product has recorded every message it wrote since the day it could write
 * one, and showed an organizer none of them — so "did that invitation actually
 * arrive?" could only be answered by asking the recipient.
 */
export default function MessagesPage({ eventSlug }: { readonly eventSlug: EventSlug }) {
  const log = useMessageLog(eventSlug)
  const [term, setTerm] = useState('')

  useEffect(() => {
    document.title = 'Messages — Open Events'
  }, [])

  const messages = useMemo(() => log.data ?? [], [log.data])
  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (needle === '') return messages
    return messages.filter(
      (message) =>
        message.toEmail.toLowerCase().includes(needle) ||
        message.subject.toLowerCase().includes(needle),
    )
  }, [messages, term])

  return (
    <div className="grid gap-4">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Messages</PageHeaderTitle>
          <PageHeaderDescription>
            Everything this event has sent, newest first — who it went to, and what it said.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      {log.isError ? <AlertLive>The message log is unavailable right now.</AlertLive> : null}

      {log.isPending ? (
        <div aria-busy="true" className="grid gap-2">
          <StatusLive>Loading the messages…</StatusLive>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : messages.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          description="Sign-in links, acceptances and reminders appear here as the event sends them."
        />
      ) : (
        <>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="message-search">Search messages</FieldLabel>
            <Input
              id="message-search"
              type="search"
              value={term}
              placeholder="Recipient or subject"
              onChange={(event) => setTerm(event.target.value)}
            />
          </Field>

          <StatusLive aria-live="polite">
            {`${matches.length} of ${messages.length} message(s) shown.`}
          </StatusLive>

          {matches.length === 0 ? (
            <EmptyState
              title="Nothing matches that"
              description="Try part of an email address or a subject line."
            />
          ) : (
            <ul className="grid gap-2" aria-label="Sent messages">
              {matches.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function MessageRow({ message }: { readonly message: MessageLogEntryDto }) {
  const [open, setOpen] = useState(false)
  const bodyId = `message-body-${message.id}`

  return (
    <li className="grid gap-2 rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="grid min-w-0">
          <span className="truncate text-sm font-medium">{message.subject}</span>
          <span className="truncate text-xs text-muted-foreground">
            {`To ${message.toEmail} · ${formatSentAt(message.createdAt)}`}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Badge variant="outline">{kindLabel(message.kind)}</Badge>
          {/* The body is behind a disclosure rather than on the row. A sign-in
              link is in there, and a screen that sprays every one of them at
              once is a screen nobody can safely read over a shoulder. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? 'Hide message' : 'View message'}
          </Button>
        </span>
      </div>
      {open ? (
        <pre
          id={bodyId}
          className="overflow-x-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap"
        >
          {message.body}
        </pre>
      ) : null}
    </li>
  )
}
