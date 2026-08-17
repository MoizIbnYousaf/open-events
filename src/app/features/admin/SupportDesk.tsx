import { useEffect, useRef, useState } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/empty-state'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { Textarea } from '../../../components/ui/textarea'
import { cn } from '../../../lib/utils'
import AppShell from '../nav/AppShell'
import {
  useAdminSupportChat,
  useArchiveSupportChat,
  useSendAdminSupportMessage,
  useSupportChatList,
} from '../../queries/support'
import { ORBY_NAME } from '../../../domain/support'
import type {
  SupportChatListItemDto,
  SupportMessageDto,
} from '../../../application/services/support'

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatWhen(value: string | null): string {
  if (value === null) return 'No messages yet'
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : timeFmt.format(new Date(parsed))
}

function dateKey(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toISOString().slice(0, 10)
}

function dateLabel(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full' }).format(new Date(parsed))
}

function previewLine(item: SupportChatListItemDto): string {
  if (item.lastMessagePreview === null) return 'No messages yet'
  const prefix = item.lastMessageSender === 'admin' ? 'You: ' : ''
  return `${prefix}${item.lastMessagePreview}`
}

function MessageBubble({
  message,
  userName,
}: {
  readonly message: SupportMessageDto
  readonly userName: string
}) {
  const fromOrby = message.senderType === 'admin'
  return (
    <div className={cn('flex', fromOrby ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2',
          fromOrby ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        <p className="text-[11px] font-medium opacity-80">{fromOrby ? ORBY_NAME : userName}</p>
        <p className="text-[13px] leading-5 whitespace-pre-wrap">{message.content}</p>
        <p className="mt-1 text-[11px] opacity-70">{formatWhen(message.createdAt)}</p>
      </div>
    </div>
  )
}

export default function SupportDesk({ eventSlug }: { readonly eventSlug: string }) {
  const [archived, setArchived] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const list = useSupportChatList(eventSlug, archived)
  const chats = list.data ?? []
  const activeId = selectedId ?? chats[0]?.id ?? null
  const detail = useAdminSupportChat(eventSlug, activeId)
  const send = useSendAdminSupportMessage(eventSlug, activeId)
  const archive = useArchiveSupportChat(eventSlug)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = 'Organizer manual support — Open Events'
  }, [])

  useEffect(() => {
    const node = threadRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [detail.data?.messages.length])

  return (
    <AppShell slug={eventSlug}>
      <div className="grid gap-4" data-tour="orby-workspace">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Organizer manual support</PageHeaderTitle>
            <PageHeaderDescription>
              Human support conversations. Organizer replies appear as {ORBY_NAME}.
            </PageHeaderDescription>
          </PageHeaderContent>
        </PageHeader>

        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={archived ? 'ghost' : 'secondary'}
            onClick={() => {
              setArchived(false)
              setSelectedId(null)
            }}
          >
            Active
          </Button>
          <Button
            type="button"
            size="sm"
            variant={archived ? 'secondary' : 'ghost'}
            onClick={() => {
              setArchived(true)
              setSelectedId(null)
            }}
          >
            Archived
          </Button>
        </div>

        {list.isError ? <AlertLive>The support desk is unavailable right now.</AlertLive> : null}

        {list.isPending ? (
          <div aria-busy="true" className="grid gap-2">
            <StatusLive>Loading conversations…</StatusLive>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : chats.length === 0 ? (
          <EmptyState
            title={archived ? 'Nothing archived' : 'No conversations yet'}
            description={
              archived
                ? 'Restored threads come back to Active.'
                : `${ORBY_NAME} appears when someone writes in from the public widget.`
            }
          />
        ) : (
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <ul
              aria-label="Support conversations"
              className="grid w-full shrink-0 gap-0.5 xl:w-[22rem]"
            >
              {chats.map((chat) => {
                const active = activeId === chat.id
                return (
                  <li key={chat.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'grid w-full min-w-0 gap-0.5 rounded-md px-3 py-2 text-left outline-none',
                        'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'bg-muted' : '',
                        chat.unread ? 'border-l-2 border-primary' : '',
                      )}
                      onClick={() => setSelectedId(chat.id)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{chat.userEmail}</span>
                        {chat.unread ? <Badge variant="secondary">Unread</Badge> : null}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {previewLine(chat)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {`${chat.messageCount} messages · ${formatWhen(chat.lastMessageAt)}`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {detail.data !== undefined ? (
              <div className="flex min-w-0 w-full max-w-3xl flex-col rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{detail.data.userEmail}</p>
                    <p className="truncate text-xs text-muted-foreground">{detail.data.userName}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      archive.mutate({
                        chatId: detail.data.id,
                        archived: !detail.data.archived,
                      })
                    }
                  >
                    {detail.data.archived ? 'Restore' : 'Archive'}
                  </Button>
                </div>
                <div ref={threadRef} className="grid max-h-[28rem] gap-3 overflow-y-auto px-4 py-4">
                  {detail.data.messages.map((message, index) => {
                    const key = dateKey(message.createdAt)
                    const previous = detail.data.messages[index - 1]
                    const showDate = previous === undefined || dateKey(previous.createdAt) !== key
                    return (
                      <div key={message.id} className="grid gap-2">
                        {showDate ? (
                          <p className="text-center text-[11px] text-muted-foreground">
                            {dateLabel(message.createdAt)}
                          </p>
                        ) : null}
                        <MessageBubble message={message} userName={detail.data.userName} />
                      </div>
                    )
                  })}
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
                  <label className="sr-only" htmlFor="orby-admin-draft">
                    Reply as {ORBY_NAME}
                  </label>
                  <Textarea
                    id="orby-admin-draft"
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
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={send.isPending || draft.trim() === ''}
                    >
                      Reply as {ORBY_NAME}
                    </Button>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  )
}
