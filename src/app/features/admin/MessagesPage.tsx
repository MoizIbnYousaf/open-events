import { useEffect, useMemo, useState } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
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
import { cn } from '../../../lib/utils'
import { useMessageLog } from '../../queries/admin-messages'
import type { EventSlug } from '../../../domain'
import type { MessageLogEntryDto } from '../../../application'
import { useProgrammeSpotlight } from './useProgrammeSpotlight'
import { messageKindLabel } from '../../../domain/message-kind'

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
function kindLabel(kind: string, subject?: string): string {
  return messageKindLabel(kind, subject)
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
  const { spotlightId, select } = useProgrammeSpotlight(matches.map((message) => message.id))
  const selected = matches.find((message) => message.id === spotlightId) ?? matches[0] ?? null

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
            <div
              data-slot="messages-canvas"
              data-spotlight={selected?.id ?? undefined}
              className="flex flex-col gap-4 xl:flex-row xl:items-start"
            >
              <ul
                data-slot="messages-list"
                aria-label="Sent messages"
                className="grid w-full shrink-0 gap-0.5 xl:w-[22rem]"
              >
                {matches.map((message) => {
                  const active = selected?.id === message.id
                  return (
                    <li key={message.id}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'grid w-full min-w-0 gap-0.5 rounded-md px-3 py-2 text-left outline-none',
                          'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
                          active ? 'bg-muted' : '',
                        )}
                        onClick={() => select(message.id)}
                      >
                        <span className="truncate text-sm font-medium">{message.subject}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {`To ${message.toEmail} · ${formatSentAt(message.createdAt)}`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {selected !== null ? <MessagePeek message={selected} /> : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MessagePeek({ message }: { readonly message: MessageLogEntryDto }) {
  return (
    <Card data-slot="messages-peek" className="min-w-0 w-full max-w-3xl">
      <CardHeader className="border-b">
        <CardTitle level={2}>{message.subject}</CardTitle>
        <CardDescription>
          {`To ${message.toEmail} · ${formatSentAt(message.createdAt)}`}
        </CardDescription>
        <CardAction>
          <Badge variant="outline">{kindLabel(message.kind, message.subject)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* One body at a time. A sign-in link is often in there, and a
            screen that sprays every one of them at once is a screen nobody
            can safely read over a shoulder. */}
        <pre className="text-[15px] leading-relaxed whitespace-pre-wrap font-sans">
          {message.body}
        </pre>
      </CardContent>
    </Card>
  )
}
