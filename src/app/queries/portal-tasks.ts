import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { requestJson } from '../api/admin-events'

/** One speaker-portal task row (REQ-011). Labels only — never contact ids. */
export interface PortalTask {
  readonly id: string
  readonly title: string
  readonly status: 'pending' | 'complete'
  readonly completedAt: string | null
}

/** One organizer readiness row (REQ-012). */
export interface ReadinessRow {
  readonly submissionId: string
  readonly title: string
  readonly speakerEmail: string
  readonly outstandingCount: number
  readonly completeCount: number
}

/** Bounded polling interval for organizer readiness (DEC-005). */
export const READINESS_POLL_INTERVAL_MS = 30_000

export const portalTaskQueryKeys = {
  tasks: () => ['portal', 'tasks'] as const,
  readiness: (eventSlug: string) => ['admin', 'events', eventSlug, 'readiness'] as const,
}

/** GET /api/public/tasks — 401 propagates as the unauthenticated seam. */
export async function getPortalTasks(): Promise<readonly PortalTask[]> {
  const envelope = await requestJson<{ readonly tasks: readonly PortalTask[] }>('/api/public/tasks')
  return envelope.tasks
}

/** POST /api/public/tasks/:id/complete */
export async function completePortalTask(taskId: string): Promise<PortalTask> {
  const envelope = await requestJson<{ readonly task: PortalTask }>(
    `/api/public/tasks/${encodeURIComponent(taskId)}/complete`,
    { method: 'POST' },
  )
  return envelope.task
}

/**
 * GET /api/admin/readiness?eventSlug=:slug — the readiness path is the agreed
 * cross-slice contract; the eventSlug parameter scopes the request to the
 * routed event so the surface can only ever read that event's rows (and
 * speaker labels), never an unscoped all-events dataset.
 */
export async function getOrganizerReadiness(eventSlug: string): Promise<readonly ReadinessRow[]> {
  const envelope = await requestJson<{ readonly rows: readonly ReadinessRow[] }>(
    `/api/admin/readiness?eventSlug=${encodeURIComponent(eventSlug)}`,
  )
  return envelope.rows
}

export function portalTasksQueryOptions() {
  return {
    queryKey: portalTaskQueryKeys.tasks(),
    queryFn: getPortalTasks,
    retry: false,
  } as const
}

/**
 * Readiness options with the interval pinned so the poll stays bounded. An
 * empty slug disables the query rather than falling back to an unscoped fetch.
 */
export function organizerReadinessQueryOptions(eventSlug: string) {
  return {
    queryKey: portalTaskQueryKeys.readiness(eventSlug),
    queryFn: () => getOrganizerReadiness(eventSlug),
    refetchInterval: READINESS_POLL_INTERVAL_MS,
    enabled: eventSlug !== '',
    retry: false,
  } as const
}

export function usePortalTasks() {
  return useQuery(portalTasksQueryOptions())
}

export function useOrganizerReadiness(eventSlug: string) {
  return useQuery(organizerReadinessQueryOptions(eventSlug))
}

/**
 * Optimistic completion: flips the task locally, rolls back on failure, and
 * invalidates ['portal','tasks'] so the server stays the source of truth.
 */
export function useCompletePortalTask() {
  const queryClient = useQueryClient()
  const queryKey = portalTaskQueryKeys.tasks()
  return useMutation({
    mutationFn: (taskId: string) => completePortalTask(taskId),
    retry: false,
    onMutate: async (taskId: string) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<readonly PortalTask[]>(queryKey)
      if (previous !== undefined) {
        queryClient.setQueryData<readonly PortalTask[]>(
          queryKey,
          previous.map((task) =>
            task.id === taskId ? { ...task, status: 'complete' as const } : task,
          ),
        )
      }
      return { previous }
    },
    onError: (_error, _taskId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<readonly PortalTask[]>(queryKey, context.previous)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}
