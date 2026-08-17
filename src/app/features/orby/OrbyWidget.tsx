import { useEffect, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { Button } from '../../../components/ui/button'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { Textarea } from '../../../components/ui/textarea'
import { AlertLive } from '../../../components/ui/alert-live'
import { cn } from '../../../lib/utils'
import { DEFAULT_EVENT_SLUG } from '../../lib/default-event'
import {
  useIdentifySupport,
  useMarkSupportRead,
  useSendSupportMessage,
  useSupportSession,
} from '../../queries/support'
import { ORBY_NAME } from '../../../domain/support'
import type { SupportMessageDto } from '../../../application/services/support'

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  minute: '2-digit',
})

function formatTime(value: string): string {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : timeFmt.format(new Date(parsed))
}

function isAdminSurface(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/embed/')
}

function MessageRow({ message }: { readonly message: SupportMessageDto }) {
  const fromOrby = message.senderType === 'admin'
  return (
    <div className={cn('flex', fromOrby ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2',
          fromOrby ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
        )}
      >
        <p className="text-[13px] leading-5 whitespace-pre-wrap">{message.content}</p>
        <p
          className={cn(
            'mt-1 text-[11px]',
            fromOrby ? 'text-muted-foreground' : 'text-primary-foreground/80',
          )}
        >
          {`${message.senderName} · ${formatTime(message.createdAt)}`}
        </p>
      </div>
    </div>
  )
}

export default function OrbyWidget() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const hidden = isAdminSurface(pathname)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const session = useSupportSession(DEFAULT_EVENT_SLUG, open && !hidden, !hidden)
  const identify = useIdentifySupport(DEFAULT_EVENT_SLUG)
  const send = useSendSupportMessage(DEFAULT_EVENT_SLUG)
  const markRead = useMarkSupportRead(DEFAULT_EVENT_SLUG)

  const role = session.data?.role
  const chat = session.data?.chat ?? null
  const unread = chat?.unreadCount ?? 0
  const connected = session.isSuccess && !session.isError

  const markReadNow = markRead.mutate
  useEffect(() => {
    if (open && unread > 0) markReadNow()
  }, [open, unread, markReadNow])

  useEffect(() => {
    const node = listRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [chat?.messages.length, open])

  if (hidden || role === 'organizer') return null

  const badge = unread > 9 ? '9+' : String(unread)

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2">
      {open ? (
        <section
          aria-label={`${ORBY_NAME} support`}
          className="pointer-events-auto flex w-[min(100vw-2rem,22rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-popover"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <img src="/orby-mascot.png?v=1" alt="" className="size-10 shrink-0 object-contain" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{ORBY_NAME}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 rounded-full',
                      connected ? 'bg-emerald-500' : 'bg-muted-foreground/50',
                    )}
                  />
                  {connected ? 'Open Events assistant' : 'Reconnecting'}
                </p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </header>
          {session.data?.needsIdentity === true || chat === null ? (
            <form
              className="grid gap-3 p-3"
              onSubmit={(event) => {
                event.preventDefault()
                identify.mutate({ name, email })
              }}
            >
              <p className="text-[13px] leading-5 text-muted-foreground">
                {`${ORBY_NAME} answers questions about this event. Leave a name and email to start.`}
              </p>
              <Field>
                <FieldLabel htmlFor="orby-name">Name</FieldLabel>
                <Input
                  id="orby-name"
                  value={name}
                  autoComplete="name"
                  onChange={(change) => setName(change.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="orby-email">Email</FieldLabel>
                <Input
                  id="orby-email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(change) => setEmail(change.target.value)}
                />
              </Field>
              {identify.isError ? <AlertLive>Could not start the conversation.</AlertLive> : null}
              <Button type="submit" disabled={identify.isPending}>
                Start chat
              </Button>
            </form>
          ) : (
            <>
              <div ref={listRef} className="grid max-h-80 gap-2 overflow-y-auto px-3 py-3">
                {chat.messages.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    {`Ask about the CFP, speaker access, reviews, or the schedule.`}
                  </p>
                ) : (
                  chat.messages.map((message) => <MessageRow key={message.id} message={message} />)
                )}
              </div>
              <form
                className="grid gap-2 border-t border-border p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  const content = draft.trim()
                  if (content.length === 0 || send.isPending) return
                  send.mutate(content, { onSuccess: () => setDraft('') })
                }}
              >
                <label className="sr-only" htmlFor="orby-draft">
                  Message
                </label>
                <Textarea
                  id="orby-draft"
                  rows={2}
                  value={draft}
                  className="min-h-[4.5rem] resize-none text-sm"
                  onChange={(change) => setDraft(change.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">Enter to send</p>
                  <Button type="submit" size="sm" disabled={send.isPending || draft.trim() === ''}>
                    {send.isPending ? 'Thinking…' : 'Send'}
                  </Button>
                </div>
              </form>
            </>
          )}
        </section>
      ) : null}
      <Button
        type="button"
        className="pointer-events-auto relative h-14 rounded-full border border-primary/30 bg-card px-2 pr-4 text-foreground shadow-popover transition-transform hover:scale-[1.03] hover:bg-card"
        aria-expanded={open}
        aria-label={unread > 0 ? `${ORBY_NAME}, ${unread} unread` : `Chat with ${ORBY_NAME}`}
        onClick={() => setOpen((value) => !value)}
      >
        <img src="/orby-mascot.png?v=1" alt="" className="size-11 shrink-0 object-contain" />
        <span className="text-sm font-semibold">{open ? 'Close Orby' : 'Ask Orby'}</span>
        {!open && unread > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
            {badge}
          </span>
        ) : null}
      </Button>
    </div>
  )
}
