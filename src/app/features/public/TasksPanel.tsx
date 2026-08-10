import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { getApiErrorCode } from '../../api/admin-events'
import { useCompletePortalTask, usePortalTasks, type PortalTask } from '../../queries/portal-tasks'

/**
 * REQ-011 speaker task panel. Standalone: it owns no h1 so a host page keeps
 * its page-owned heading. Completion is optimistic and rolls back on failure.
 */
export default function TasksPanel() {
  const query = usePortalTasks()
  const complete = useCompletePortalTask()

  if (query.isPending) {
    return (
      <section aria-label="Your tasks" aria-busy="true">
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <StatusLive>Loading your tasks…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (query.isError) {
    const unauthenticated =
      getApiErrorCode(query.error) === 'unauthenticated' ||
      (query.error as { status?: number } | null)?.status === 401
    return (
      <section aria-label="Your tasks">
        <Card>
          <CardContent className="grid gap-3">
            {unauthenticated ? (
              <StatusLive>Sign in to view your tasks.</StatusLive>
            ) : (
              <>
                <AlertLive>Unable to load your tasks.</AlertLive>
                <Button variant="outline" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    )
  }

  const tasks: readonly PortalTask[] = query.data

  return (
    <section aria-label="Your tasks" className="grid gap-3">
      <h2 className="text-lg font-semibold">Your tasks</h2>
      {complete.isError ? <AlertLive>Unable to complete that task.</AlertLive> : null}
      {tasks.length === 0 ? (
        <Card>
          <CardContent>
            <StatusLive>No tasks yet.</StatusLive>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <span className="grid gap-1">
                <span
                  className={
                    task.status === 'complete' ? 'text-sm line-through' : 'text-sm font-medium'
                  }
                >
                  {task.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {task.status === 'complete' ? 'Complete' : 'Outstanding'}
                </span>
              </span>
              {task.status === 'complete' ? null : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-8 px-3"
                  disabled={complete.isPending}
                  onClick={() => complete.mutate(task.id)}
                >
                  {`Mark complete: ${task.title}`}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
