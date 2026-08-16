import { readinessFromTasksAndAssignments } from '../../domain/readiness-assignments'
import { toSubmissionReadinessDto } from '../dtos/speaker-task.dto'
import type { ProgrammeRepository } from '../ports/programme-repository'
import type { SpeakerTaskRepository } from '../ports/speaker-task-repository'
import type { SubmissionRepository } from '../ports/submission-repository'
import { OnboardingService as BaseOnboardingService } from './onboarding-base'
import { attributeAssignmentReadiness } from './readiness-assignment-attribution'

export type { AssignFormTaskInput } from './onboarding-base'

type BaseArgs = ConstructorParameters<typeof BaseOnboardingService>
type ReadinessArgs = Parameters<BaseOnboardingService['readiness']>
type ReadinessResult = Awaited<ReturnType<BaseOnboardingService['readiness']>>

/**
 * Keeps the established onboarding lifecycle while correcting the grain of
 * event-wide speaker assignments in readiness reporting.
 */
export class OnboardingService extends BaseOnboardingService {
  readonly #submissions: SubmissionRepository
  readonly #tasks: SpeakerTaskRepository
  readonly #programme: ProgrammeRepository | null

  constructor(...args: BaseArgs) {
    super(...args)
    this.#submissions = args[0]
    this.#tasks = args[2]
    this.#programme = args[11] ?? null
  }

  override async readiness(
    actor: ReadinessArgs[0],
    eventId: ReadinessArgs[1],
  ): Promise<ReadinessResult> {
    const base = await super.readiness(actor, eventId)
    const acceptedIds = new Set(base.submissions.map((submission) => submission.submissionId))
    const tasks = (await this.#tasks.listByEvent(eventId)).filter((task) =>
      acceptedIds.has(task.submissionId),
    )

    const contributorGroups = await Promise.all(
      base.submissions.map(async (submission) => ({
        submissionId: submission.submissionId,
        contributorIds: (
          await this.#submissions.listContributorsBySubmission(eventId, submission.submissionId)
        ).map((contributor) => contributor.contactId),
      })),
    )

    const assignmentGroups =
      this.#programme === null
        ? []
        : await Promise.all(
            (await this.#programme.listAssignments(eventId)).map(async (assignment) => ({
              assignees: await this.#programme!.listAssignees(assignment.id),
            })),
          )
    const attribution = attributeAssignmentReadiness(contributorGroups, assignmentGroups)
    const submissions = base.submissions.map((submission) => {
      const own = tasks.filter((task) => task.submissionId === submission.submissionId)
      const extra = attribution.bySubmission.get(submission.submissionId) ?? {
        total: 0,
        completed: 0,
      }
      return toSubmissionReadinessDto(submission.submissionId, submission.title, own, extra)
    })
    const totals = readinessFromTasksAndAssignments(tasks, attribution.event)

    return {
      ...base,
      totalTasks: totals.totalTasks,
      completedTasks: totals.completedTasks,
      percentComplete: totals.percentComplete,
      submissions,
    }
  }
}
