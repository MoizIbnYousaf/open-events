import { useEffect } from 'react'
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'

import AppShell from '../features/nav/AppShell'
import MessagesPage from '../features/admin/MessagesPage'
import { ExpiredSessionState } from '../features/admin/AdminStates'
import { getApiErrorCode } from '../api/admin-events'
import { useMessageLog } from '../queries/admin-messages'

import type {} from '../routeTree.gen'

function MessagesRoutePage() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  const query = useMessageLog(slug ?? '')
  // An expired session is a dead end, and a dead end is a PAGE: rendered inside
  // the rail it was a card in a shell full of destinations the reader can no
  // longer open. Bare is what the majority of organizer routes render and what
  // the AdminStates grammar is drawn for. The observer shares the page's own
  // query, so asking one level up adds no request.
  if (query.isError && getApiErrorCode(query.error) === 'unauthorized') {
    return <ExpiredMessagesSession />
  }
  return (
    <AppShell slug={slug ?? ''}>
      <MessagesPage eventSlug={slug ?? ''} />
    </AppShell>
  )
}

/** Its own component so the router hook runs only when the branch renders. */
function ExpiredMessagesSession() {
  const navigate = useNavigate()
  useEffect(() => {
    document.title = 'Session expired — Open Events'
  }, [])
  return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
}

const messagesRoute = createFileRoute('/admin_/events/$slug_/messages')({
  component: MessagesRoutePage,
})

// The generated route tree normally injects `path` via update(); the
// direct-import surface contract also exposes it on the module itself.
Object.assign(messagesRoute.options, { path: '/admin/events/$slug/messages' })

// Narrow documented surface type: the test contract reads `options.path`
// directly off the module; the library Route options type omits it.
export const Route = messagesRoute as typeof messagesRoute & {
  readonly options: { readonly path: string }
}
