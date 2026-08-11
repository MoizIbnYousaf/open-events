import { useEffect } from 'react'
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'

import AppShell from '../features/nav/AppShell'
import ReadinessPage from '../features/admin/ReadinessPage'
import { ExpiredSessionState } from '../features/admin/AdminStates'
import { getApiErrorCode } from '../api/admin-events'
import { useOrganizerReadiness } from '../queries/portal-tasks'

import type {} from '../routeTree.gen'

function ReadinessRoutePage() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  const query = useOrganizerReadiness(slug ?? '')
  // An expired session is a dead end, and a dead end is a PAGE: rendered inside
  // the rail it was a card in a shell full of destinations the reader can no
  // longer open. Bare is what the majority of organizer routes render and what
  // the AdminStates grammar is drawn for. The observer shares the page's own
  // query, so asking one level up adds no request.
  if (query.isError && getApiErrorCode(query.error) === 'unauthorized') {
    return <ExpiredReadinessSession />
  }
  return (
    <AppShell slug={slug ?? ''}>
      <ReadinessPage eventSlug={slug ?? ''} />
    </AppShell>
  )
}

/** Its own component so the router hook runs only when the branch renders. */
function ExpiredReadinessSession() {
  const navigate = useNavigate()
  useEffect(() => {
    document.title = 'Session expired — Open Events'
  }, [])
  return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
}

const readinessRoute = createFileRoute('/admin_/events/$slug_/readiness')({
  component: ReadinessRoutePage,
})

// The generated route tree normally injects `path` via update(); the
// direct-import surface contract also exposes it on the module itself.
Object.assign(readinessRoute.options, { path: '/admin/events/$slug/readiness' })

// Narrow documented surface type: the test contract reads `options.path`
// directly off the module; the library Route options type omits it.
export const Route = readinessRoute as typeof readinessRoute & {
  readonly options: { readonly path: string }
}
