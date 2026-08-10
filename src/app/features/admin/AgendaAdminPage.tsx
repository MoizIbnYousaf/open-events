import { useEffect, useState } from 'react'

import type { AgendaSessionRecord } from '../../../db/agenda-repository'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { ForbiddenState } from './AdminStates'
import { loadAgendaDndBoard } from './AgendaDndBoard'

type AgendaState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'denied' }
  | { readonly status: 'empty' }
  | { readonly status: 'ready'; readonly sessions: readonly AgendaSessionRecord[] }

interface AgendaAdminPageProps {
  readonly eventSlug: string
}

export default function AgendaAdminPage({ eventSlug }: AgendaAdminPageProps) {
  const [state, setState] = useState<AgendaState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({})

  useEffect(() => {
    document.title = 'Agenda — SpeakerOps'
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/admin/events/${encodeURIComponent(eventSlug)}/agenda`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          const envelope = (await response.json().catch(() => null)) as {
            readonly error?: { readonly code?: string }
          } | null
          setState(
            envelope?.error?.code === 'forbidden' ? { status: 'denied' } : { status: 'error' },
          )
          return
        }
        const sessions = (await response.json()) as readonly AgendaSessionRecord[]
        setState(sessions.length === 0 ? { status: 'empty' } : { status: 'ready', sessions })
      } catch {
        if (controller.signal.aborted) return
        setState({ status: 'error' })
      }
    }
    void load()
    return () => controller.abort()
  }, [eventSlug, attempt])

  if (state.status === 'denied') {
    return <ForbiddenState />
  }

  if (state.status === 'loading') {
    return (
      <Card aria-busy="true" aria-label="Loading agenda sessions">
        <CardContent className="grid gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Agenda</h1>
      {state.status === 'error' ? (
        <Card>
          <CardContent className="grid gap-3">
            <AlertLive>Unable to load the agenda.</AlertLive>
            <Button variant="outline" onClick={() => setAttempt((current) => current + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {state.status === 'empty' ? (
        <Card>
          <CardContent>
            <StatusLive>No agenda sessions yet.</StatusLive>
          </CardContent>
        </Card>
      ) : null}
      {state.status === 'ready' ? (
        <Card>
          <CardContent className="grid gap-3">
            {state.sessions.map((session) => {
              const isToggled = toggled[session.submissionId] ?? false
              const displayStatus = isToggled
                ? session.status === 'published'
                  ? 'draft'
                  : 'published'
                : session.status
              const toggleStatus = () => {
                setToggled((current) => ({
                  ...current,
                  [session.submissionId]: !(current[session.submissionId] ?? false),
                }))
              }
              const startPlacement = () => {
                void loadAgendaDndBoard().catch(() => undefined)
              }
              return (
                <div
                  key={session.submissionId}
                  className="grid gap-2 rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-medium">{session.submissionId}</span>
                    <span>{session.day}</span>
                    <span>{session.start}</span>
                    <span>{session.end}</span>
                    <span>{String(session.roomId)}</span>
                    <span>{String(session.trackId)}</span>
                    <span>{String(session.position)}</span>
                    <span>{displayStatus}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={toggleStatus}>
                      Toggle status {session.submissionId}
                    </Button>
                    {isToggled ? (
                      <Button type="button" variant="outline" size="sm" onClick={startPlacement}>
                        Move {session.submissionId}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
