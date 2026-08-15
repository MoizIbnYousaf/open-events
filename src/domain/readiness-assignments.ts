import { computeReadinessTotals, type ReadinessTotals, type SpeakerTask } from './speaker-task.ts'

/** Extra checklist items from speaker assignments that land on a session. */
export function extraReadinessFromAssignments(
  contributorIds: ReadonlySet<string>,
  assignees: readonly { readonly contactId: string; readonly status: string }[],
): { readonly total: number; readonly completed: number } {
  let total = 0
  let completed = 0
  for (const assignee of assignees) {
    if (!contributorIds.has(assignee.contactId)) continue
    total += 1
    if (assignee.status === 'completed') completed += 1
  }
  return { total, completed }
}

/** Combine the fixed onboarding checklist with assigned extra work. */
export function mergeReadinessTotals(
  base: ReadinessTotals,
  extra: { readonly total: number; readonly completed: number },
): ReadinessTotals {
  const totalTasks = base.totalTasks + extra.total
  const completedTasks = base.completedTasks + extra.completed
  return {
    totalTasks,
    completedTasks,
    percentComplete: totalTasks === 0 ? 100 : Math.round((completedTasks / totalTasks) * 100),
  }
}

/** Session readiness including file-request and general assignments. */
export function readinessFromTasksAndAssignments(
  tasks: readonly SpeakerTask[],
  extra: { readonly total: number; readonly completed: number },
): ReadinessTotals {
  return mergeReadinessTotals(computeReadinessTotals(tasks), extra)
}
