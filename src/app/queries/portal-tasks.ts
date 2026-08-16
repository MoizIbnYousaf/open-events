import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import type {
  EventReadinessDto,
  FormDefinitionDto,
  SpeakerTaskDto,
  SubmissionReadinessDto,
} from '../../application'
import type { AnswerMap, SpeakerTaskKind, SpeakerTaskStatus } from '../../domain'
import { requestJson } from '../api/admin-events'

/**
 * One speaker-portal task row (REQ-011), projected from the SpeakerTaskDto the
 * API actually sends. Labels only — never contact ids. The wire carries no
 * human title: the checklist is a fixed set of kinds, so the label is
 * presentation copy owned here and the submission title gives it context.
 */
export interface PortalTask {
  readonly id: string
  readonly kind: SpeakerTaskKind
  readonly submissionTitle: string
  readonly status: SpeakerTaskStatus
  readonly completedAt: string | null
}

/** Human label per frozen checklist kind (src/domain/speaker-task.ts). */
const SPEAKER_TASK_LABELS: Readonly<Record<SpeakerTaskKind, string>> = {
  confirm_participation: 'Confirm your participation',
  submit_bio: 'Submit your speaker bio',
  submit_headshot: 'Upload your headshot',
  complete_form: 'Fill out the assigned form',
}

export function speakerTaskLabel(kind: SpeakerTaskKind): string {
  return SPEAKER_TASK_LABELS[kind]
}

/**
 * One organizer readiness row (REQ-012), projected from the per-submission
 * entry of EventReadinessDto. Every field is either sent by the server or
 * derived from two fields that are; the aggregate carries no speaker identity,
 * so this surface deliberately shows none.
 */
export interface ReadinessRow {
  readonly submissionId: string
  readonly title: string
  readonly totalTasks: number
  readonly completedTasks: number
  readonly outstandingCount: number
  readonly percentComplete: number
  readonly ready: boolean
  readonly missingTaskKinds: readonly SpeakerTaskKind[]
  readonly blockers: readonly string[]
}

/** Bounded polling interval for organizer readiness (DEC-005). */
export const READINESS_POLL_INTERVAL_MS = 30_000

export const portalTaskQueryKeys = {
  tasks: () => ['portal', 'tasks'] as const,
  taskForm: (taskId: string) => ['portal', 'tasks', taskId, 'form'] as const,
  readiness: (eventSlug: string) => ['admin', 'events', eventSlug, 'readiness'] as const,
}

function toPortalTask(task: SpeakerTaskDto): PortalTask {
  return {
    id: task.id,
    kind: task.kind,
    submissionTitle: task.submissionTitle,
    status: task.status,
    completedAt: task.completedAt,
  }
}

function toReadinessRow(submission: SubmissionReadinessDto): ReadinessRow {
  return {
    submissionId: submission.submissionId,
    title: submission.title,
    totalTasks: submission.totalTasks,
    completedTasks: submission.completedTasks,
    outstandingCount: submission.totalTasks - submission.completedTasks,
    percentComplete: submission.percentComplete,
    ready: submission.ready,
    missingTaskKinds: submission.missingTaskKinds ?? [],
    blockers: submission.blockers ?? [],
  }
}

/**
 * GET /api/public/tasks — the server answers a BARE SpeakerTaskDto array (no
 * envelope); 401 propagates as the unauthenticated seam.
 */
export async function getPortalTasks(): Promise<readonly PortalTask[]> {
  const tasks = await requestJson<readonly SpeakerTaskDto[]>('/api/public/tasks')
  return tasks.map(toPortalTask)
}

/** POST /api/public/tasks/:id/complete — answers the bare updated task. */
export async function completePortalTask(taskId: string): Promise<PortalTask> {
  const task = await requestJson<SpeakerTaskDto>(
    `/api/public/tasks/${encodeURIComponent(taskId)}/complete`,
    { method: 'POST' },
  )
  return toPortalTask(task)
}

/** GET /api/public/tasks/:id/form — the published definition behind a form task. */
export function useTaskForm(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: portalTaskQueryKeys.taskForm(taskId),
    queryFn: () =>
      requestJson<FormDefinitionDto>(`/api/public/tasks/${encodeURIComponent(taskId)}/form`),
    enabled,
    retry: false,
  })
}

/**
 * Completes a form task with its answers payload. The server re-validates
 * against the pinned published version; no optimistic flip, because a
 * rejection must leave the row visibly pending.
 */
export function useCompleteFormTask() {
  const queryClient = useQueryClient()
  const queryKey = portalTaskQueryKeys.tasks()
  return useServerMutation({
    mutationFn: async (input: { readonly taskId: string; readonly answers: AnswerMap }) => {
      const task = await requestJson<SpeakerTaskDto>(
        `/api/public/tasks/${encodeURIComponent(input.taskId)}/complete`,
        { method: 'POST', body: JSON.stringify({ answers: input.answers }) },
      )
      return toPortalTask(task)
    },
    retry: false,
    onSuccess: (completed) => {
      const previous = queryClient.getQueryData<readonly PortalTask[]>(queryKey)
      if (previous !== undefined) {
        queryClient.setQueryData<readonly PortalTask[]>(
          queryKey,
          previous.map((task) => (task.id === completed.id ? completed : task)),
        )
      }
    },
  })
}

/**
 * GET /api/admin/readiness?eventSlug=:slug — the readiness path is the agreed
 * cross-slice contract; the eventSlug parameter scopes the request to the
 * routed event so the surface can only ever read that event's rows. The server
 * answers the EventReadinessDto aggregate, whose per-submission entries are the
 * table's rows.
 */
export async function getOrganizerReadiness(eventSlug: string): Promise<readonly ReadinessRow[]> {
  const readiness = await requestJson<EventReadinessDto>(
    `/api/admin/readiness?eventSlug=${encodeURIComponent(eventSlug)}`,
  )
  return readiness.submissions.map(toReadinessRow)
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
 * Optimistic completion: flips the task locally to the SERVER's own vocabulary
 * ('completed'), rolls back on failure, and invalidates ['portal','tasks'] so
 * the refetched truth matches the optimistic state instead of reverting it.
 */
export function useCompletePortalTask() {
  const queryClient = useQueryClient()
  const queryKey = portalTaskQueryKeys.tasks()
  return useServerMutation({
    mutationFn: (taskId: string) => completePortalTask(taskId),
    retry: false,
    onMutate: async (taskId: string) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<readonly PortalTask[]>(queryKey)
      if (previous !== undefined) {
        queryClient.setQueryData<readonly PortalTask[]>(
          queryKey,
          previous.map((task) =>
            task.id === taskId ? { ...task, status: 'completed' as const } : task,
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
