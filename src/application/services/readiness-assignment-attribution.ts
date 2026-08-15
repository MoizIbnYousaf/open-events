export interface AcceptedContributorGroup {
  readonly submissionId: string
  readonly contributorIds: readonly string[]
}

export interface AssignmentAssigneeGroup {
  readonly assignees: readonly {
    readonly contactId: string
    readonly status: string
  }[]
}

export interface AssignmentReadinessAttribution {
  readonly event: { readonly total: number; readonly completed: number }
  readonly bySubmission: ReadonlyMap<
    string,
    { readonly total: number; readonly completed: number }
  >
}

/**
 * Count every event-wide assignment once. It is attributed to an individual
 * proposal only when that speaker has exactly one accepted proposal; otherwise
 * the assignment remains event-level because the persisted row has no
 * submission id and guessing would make per-session readiness dishonest.
 */
export function attributeAssignmentReadiness(
  submissions: readonly AcceptedContributorGroup[],
  assignments: readonly AssignmentAssigneeGroup[],
): AssignmentReadinessAttribution {
  const submissionIdsByContact = new Map<string, string[]>()
  for (const submission of submissions) {
    for (const contactId of new Set(submission.contributorIds)) {
      const ids = submissionIdsByContact.get(contactId) ?? []
      ids.push(submission.submissionId)
      submissionIdsByContact.set(contactId, ids)
    }
  }

  const bySubmission = new Map<string, { total: number; completed: number }>()
  let total = 0
  let completed = 0
  for (const assignment of assignments) {
    for (const assignee of assignment.assignees) {
      const submissionIds = submissionIdsByContact.get(assignee.contactId)
      if (submissionIds === undefined) continue
      total += 1
      if (assignee.status === 'completed') completed += 1

      const submissionId = submissionIds.length === 1 ? submissionIds[0] : undefined
      if (submissionId === undefined) continue
      const current = bySubmission.get(submissionId) ?? { total: 0, completed: 0 }
      bySubmission.set(submissionId, {
        total: current.total + 1,
        completed: current.completed + (assignee.status === 'completed' ? 1 : 0),
      })
    }
  }

  return { event: { total, completed }, bySubmission }
}
