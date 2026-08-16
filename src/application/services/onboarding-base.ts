import type { AnswerMap } from '../../domain/answers'
import type { ContactId } from '../../domain/contact'
import type { EventId } from '../../domain/event'
import type { FormId } from '../../domain/form'
import { SPEAKER_TASK_KINDS, type SpeakerTask, type SpeakerTaskId } from '../../domain/speaker-task'
import type {
  ProposalSubmission,
  SubmissionDecision,
  SubmissionDecisionOutcome,
  SubmissionId,
} from '../../domain/submission'
import { defaultAgendaSlot } from '../../domain/agenda'
import { validateAnswersAgainstVersion } from '../../domain/invariants/submission'
import { assertSubmitterCapability, type OrganizerActor, type SubmitterActor } from '../actors'
import type {
  AcceptedSubmissionDto,
  EventReadinessDto,
  SpeakerTaskDto,
  SubmissionReadinessDto,
} from '../dtos/speaker-task.dto'
import type { SubmissionDecisionDto } from '../dtos/submission.dto'
import type { FormDefinitionDto } from '../dtos/form-definition.dto'
import { toFormDefinitionDto } from '../dtos/form-definition.dto'
import { toSpeakerTaskDto, toSubmissionReadinessDto } from '../dtos/speaker-task.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { AcceptUnitOfWork } from '../ports/accept-unit-of-work'
import type { Clock } from '../ports/clock'
import type { EventRepository } from '../ports/event-repository'
import type { TaxonomyRepository } from '../ports/taxonomy-repository'
import type { ContactRepository } from '../ports/contact-repository'
import type { FormContentRepository } from '../ports/form-content-repository'
import type { FormRepository } from '../ports/form-repository'
import type { FormVersionRepository } from '../ports/form-version-repository'
import type { SpeakerTaskRepository } from '../ports/speaker-task-repository'
import type { UploadedFileRepository } from '../ports/uploaded-file-repository'
import type { SubmissionRepository } from '../ports/submission-repository'
import type { ProgrammeRepository } from '../ports/programme-repository'
import {
  extraReadinessFromAssignments,
  readinessFromTasksAndAssignments,
} from '../../domain/readiness-assignments'

export interface AssignFormTaskInput {
  readonly formId: FormId
  readonly contactId: ContactId
}

/**
 * Onboarding core: organizer acceptance materialises the speaker checklist,
 * speakers read and complete only their own tasks, and the organizer reads
 * aggregate readiness. Acceptance and completion are both idempotent, every
 * instant comes from the service clock, and the acting identity always comes
 * from a typed actor (never from the request body or a path parameter).
 */
export class OnboardingService {
  readonly #submissions: SubmissionRepository
  readonly #events: EventRepository
  readonly #taxonomies: TaxonomyRepository
  readonly #tasks: SpeakerTaskRepository
  readonly #acceptUnitOfWork: AcceptUnitOfWork
  readonly #clock: Clock
  readonly #forms: FormRepository
  readonly #versions: FormVersionRepository
  readonly #content: FormContentRepository
  readonly #contacts: ContactRepository
  readonly #uploads: UploadedFileRepository
  readonly #programme: ProgrammeRepository | null

  constructor(
    submissions: SubmissionRepository,
    events: EventRepository,
    tasks: SpeakerTaskRepository,
    acceptUnitOfWork: AcceptUnitOfWork,
    clock: Clock,
    forms: FormRepository,
    versions: FormVersionRepository,
    content: FormContentRepository,
    contacts: ContactRepository,
    uploads: UploadedFileRepository,
    taxonomies: TaxonomyRepository,
    programme: ProgrammeRepository | null = null,
  ) {
    this.#submissions = submissions
    this.#taxonomies = taxonomies
    this.#events = events
    this.#tasks = tasks
    this.#acceptUnitOfWork = acceptUnitOfWork
    this.#clock = clock
    this.#forms = forms
    this.#versions = versions
    this.#content = content
    this.#contacts = contacts
    this.#uploads = uploads
    this.#programme = programme
  }

  /**
   * Accepts a submission, creates one task per checklist kind for every
   * contributor, and places the submission on the agenda as an unassigned
   * draft session so the organizer has something to schedule. Concurrency
   * safety comes from the unit of work: the acceptance row is the idempotency
   * key, so a repeated accept never doubles a checklist or a session, and a
   * partially failing batch writes nothing.
   */
  async accept(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<AcceptedSubmissionDto> {
    const now = this.#clock.now()
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      // Cross-event and absent are deliberately the same safe answer.
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const contributors = await this.#submissions.listContributorsBySubmission(
      submission.eventId,
      submission.id,
    )
    const tasks: SpeakerTask[] = []
    for (const contributor of contributors) {
      for (const [kindIndex, kind] of SPEAKER_TASK_KINDS.entries()) {
        tasks.push({
          id: crypto.randomUUID(),
          eventId: submission.eventId,
          submissionId: submission.id,
          contactId: contributor.contactId,
          kind,
          status: 'pending',
          position: contributor.position * SPEAKER_TASK_KINDS.length + kindIndex,
          createdAt: now,
          completedAt: null,
          formId: null,
          formVersionId: null,
          response: null,
        })
      }
    }

    // The agenda row needs a real day and slot even while it is unassigned;
    // the event start is the meaningful anchor when it is configured, and the
    // acceptance instant is the fallback for an event still without dates.
    const event = await this.#events.findById(submission.eventId)
    const slot = defaultAgendaSlot(event?.dates?.startsAt ?? now)
    // The submitter already told us the track. Matching on the LABEL is right
    // rather than lax: an answer stores the label a person read, which is the
    // same string the taxonomy shows, so this is the two records of one
    // vocabulary meeting rather than a guess. An answer naming a track the
    // event no longer recognises resolves to null instead of inventing one.
    const answeredTrack = submission.answers['track']
    const items = await this.#taxonomies.listByEvent(submission.eventId)
    const trackId =
      typeof answeredTrack === 'string'
        ? (items.find((item) => item.kind === 'track' && item.label === answeredTrack)?.id ?? null)
        : null

    const result = await this.#acceptUnitOfWork.execute({
      eventId: submission.eventId,
      submissionId: submission.id,
      acceptedAt: now,
      tasks,
      session: {
        ...slot,
        trackId,
        speakerContactIds: contributors.map((contributor) => contributor.contactId),
      },
    })
    if (result.outcome === 'not-found' || result.acceptance === null) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    return {
      submissionId: submission.id,
      eventId: submission.eventId,
      acceptedAt: result.acceptance.acceptedAt,
      alreadyAccepted: result.outcome === 'already-accepted',
      tasks: result.tasks.map((task) => toSpeakerTaskDto(task, submission.title)),
    }
  }

  /**
   * Records the programme's verdict on one submission, in either direction.
   *
   * Accepting routes through `accept`, so an acceptance still materialises the
   * onboarding checklist and the agenda draft exactly as it always did; this
   * only adds the verdict itself, which is the part the schema could not hold.
   *
   * Rejecting deliberately leaves the acceptance ROW, and the checklist and
   * agenda draft that hang their composite foreign keys off it, in place rather
   * than unwinding them — retracting it would delete work the speaker had
   * already done. The decision is the authority on the outcome instead, and
   * every acceptance-derived read filters through it: `listTasks`, `readiness`,
   * `listAcceptedOwnSubmissionIds`, the agenda board and the calendar invite
   * all drop a rejected submission. An acceptance record is not a verdict.
   *
   * The trail is append-only, so each transition is its own auditable row and
   * 'accepted, then rejected, then accepted' stays answerable after the fact.
   *
   * THE TRANSITION RULE: a verdict may be changed for as long as nobody has
   * acted on it, and becomes final the moment the accepted speaker completes
   * any onboarding task. Before that a decision is only an organizer's own
   * bookkeeping; after it, reversing one silently voids work a person did
   * because they were told they were in. Re-recording the SAME verdict stays
   * allowed forever, because it changes nothing.
   */
  async decide(
    actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
    outcome: SubmissionDecisionOutcome,
  ): Promise<SubmissionDecisionDto> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      // Cross-event and absent are deliberately the same safe answer.
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const existing = await this.#submissions.findDecision(submission.eventId, submission.id)
    // Re-recording the standing verdict appends nothing. Without this an
    // idempotent retry would grow the trail with rows that record no change,
    // and the history would stop being a record of anyone changing their mind.
    if (existing !== null && existing.outcome === outcome) {
      return this.#decisionDto(submission.eventId, submission.id, existing, false)
    }
    if (existing !== null) await this.#requireReversible(submission.eventId, submission.id)

    if (outcome === 'accepted') {
      const acceptance = await this.#tasks.findAcceptance(submission.eventId, submission.id)
      if (acceptance === null) await this.accept(actor, submission.eventId, submission.id)
    }
    const written = await this.#submissions.recordDecision({
      id: crypto.randomUUID(),
      eventId: submission.eventId,
      submissionId: submission.id,
      outcome,
      decidedBy: actor.kind,
      decidedAt: this.#clock.now(),
    })
    if (written === 'not-found') {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const recorded = await this.#submissions.findDecision(submission.eventId, submission.id)
    return this.#decisionDto(submission.eventId, submission.id, recorded, true)
  }

  /**
   * The standing verdict on one submission plus the whole trail behind it, so
   * an organizer can see that a proposal was accepted and then rejected rather
   * than only where it ended up.
   */
  async getDecision(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<SubmissionDecisionDto> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const decision = await this.#submissions.findDecision(submission.eventId, submission.id)
    return this.#decisionDto(submission.eventId, submission.id, decision, false)
  }

  /** One decision on the wire, with its trail. */
  async #decisionDto(
    eventId: EventId,
    submissionId: SubmissionId,
    decision: SubmissionDecision | null,
    changed: boolean,
  ): Promise<SubmissionDecisionDto> {
    const history = await this.#submissions.listDecisionHistory(eventId, submissionId)
    return {
      submissionId,
      eventId,
      // 'pending' is the one spelling of undecided on every wire this product
      // owns; `decidedBy`/`decidedAt` stay null because there genuinely is
      // nobody and no instant to name until a verdict exists.
      decision: decision?.outcome ?? 'pending',
      decidedBy: decision?.decidedBy ?? null,
      decidedAt: decision?.decidedAt ?? null,
      changed,
      history: history.map((entry) => ({
        sequence: entry.sequence,
        decision: entry.outcome,
        decidedBy: entry.decidedBy,
        decidedAt: entry.decidedAt,
      })),
    }
  }

  /**
   * The calling speaker's own verdicts, keyed by submission.
   *
   * A submission with an acceptance record but no decision row reads as
   * accepted: the decision table is backfilled from the acceptances that
   * predate it, and this keeps the two consistent even if a crash lands
   * between the acceptance batch and the decision write.
   */
  async listOwnDecisions(
    actor: SubmitterActor,
  ): Promise<ReadonlyMap<SubmissionId, SubmissionDecision>> {
    assertSubmitterCapability(actor, 'portal')
    const [decisions, acceptedIds] = await Promise.all([
      this.#submissions.listDecisionsByOwner(actor.eventId, actor.contactId),
      this.listAcceptedOwnSubmissionIds(actor),
    ])
    const byId = new Map(decisions.map((decision) => [decision.submissionId, decision]))
    for (const submissionId of acceptedIds) {
      if (byId.has(submissionId)) continue
      const acceptance = await this.#tasks.findAcceptance(actor.eventId, submissionId)
      if (acceptance === null) continue
      byId.set(submissionId, {
        id: `acceptance-${submissionId}`,
        eventId: actor.eventId,
        submissionId,
        sequence: 1,
        outcome: 'accepted',
        decidedBy: 'organizer',
        decidedAt: acceptance.acceptedAt,
      })
    }
    return byId
  }

  /** Conflict once the accepted speaker has completed any onboarding task. */
  async #requireReversible(eventId: EventId, submissionId: SubmissionId): Promise<void> {
    const tasks = await this.#tasks.listBySubmission(eventId, submissionId)
    if (tasks.some((task) => task.status === 'completed')) {
      throw new ApplicationError(
        'conflict',
        'That decision has been acted on by the speaker and can no longer be changed',
      )
    }
  }

  /**
   * Every onboarding task owned by the calling speaker, in checklist order —
   * minus any whose proposal has since been rejected. The acceptance row those
   * tasks hang off survives a rejection on purpose (it is their foreign key),
   * so filtering here is what stops a rejected speaker from still being asked
   * to confirm participation in a talk that is no longer happening.
   */
  async listTasks(actor: SubmitterActor): Promise<readonly SpeakerTaskDto[]> {
    assertSubmitterCapability(actor, 'portal')
    const [all, rejected] = await Promise.all([
      this.#tasks.listByContact(actor.eventId, actor.contactId),
      this.#rejectedSubmissionIds(actor.eventId),
    ])
    const tasks = all.filter((task) => !rejected.has(task.submissionId))
    const submissionIds = [...new Set(tasks.map((task) => task.submissionId))]
    const submissions = await Promise.all(
      submissionIds.map((submissionId) => this.#submissions.findById(submissionId)),
    )
    const titles = new Map(
      submissionIds.map((submissionId, index) => [submissionId, submissions[index]?.title ?? '']),
    )
    return tasks.map((task) => toSpeakerTaskDto(task, titles.get(task.submissionId) ?? ''))
  }

  /**
   * Assigns a published form to one accepted speaker as a form-backed task.
   * The task pins the form's current published version so the response is
   * always validated against a frozen definition. Re-assigning the same form
   * returns the existing task (idempotent).
   */
  async assignFormTask(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
    input: AssignFormTaskInput,
  ): Promise<SpeakerTaskDto> {
    const now = this.#clock.now()
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    // Acceptance AND the standing verdict. A rejection deliberately leaves the
    // acceptance row in place, so it cannot by itself say whether this speaker
    // is still in the programme — and the checklist read that would surface
    // this task already filters rejections, so assigning one here would create
    // work nobody could ever see. Same not-found as every other miss.
    const [acceptance, decision] = await Promise.all([
      this.#tasks.findAcceptance(submission.eventId, submission.id),
      this.#submissions.findDecision(submission.eventId, submission.id),
    ])
    if (acceptance === null || decision?.outcome === 'rejected') {
      throw new ApplicationError('not_found', `Submission '${submissionId}' is not accepted`)
    }
    const contributors = await this.#submissions.listContributorsBySubmission(
      submission.eventId,
      submission.id,
    )
    if (!contributors.some((contributor) => contributor.contactId === input.contactId)) {
      throw new ApplicationError('not_found', `Contact is not a contributor on '${submissionId}'`)
    }
    const form = await this.#forms.findById(input.formId)
    if (form === null || form.eventId !== submission.eventId) {
      throw new ApplicationError('not_found', `Form '${input.formId}' not found`)
    }
    if (form.publishedVersionId === null) {
      throw new ApplicationError('conflict', `Form '${input.formId}' has no published version`)
    }
    const version = await this.#versions.findById(form.publishedVersionId)
    if (version === null || version.status !== 'published') {
      throw new ApplicationError('conflict', `Form '${input.formId}' has no published version`)
    }
    const existing = await this.#tasks.listBySubmission(submission.eventId, submission.id)
    const created = await this.#tasks.createFormTask({
      id: crypto.randomUUID(),
      eventId: submission.eventId,
      submissionId: submission.id,
      contactId: input.contactId,
      kind: 'complete_form',
      status: 'pending',
      position: existing.length,
      createdAt: now,
      completedAt: null,
      formId: form.id,
      formVersionId: version.id,
      response: null,
    })
    return toSpeakerTaskDto(created, submission.title)
  }

  /**
   * The full published definition behind one own form task, for the portal to
   * render. Scoped exactly like completion: not-own or cross-event is 404.
   */
  async getFormTaskDefinition(
    actor: SubmitterActor,
    id: SpeakerTaskId,
  ): Promise<FormDefinitionDto> {
    assertSubmitterCapability(actor, 'portal')
    const task = await this.#tasks.findById(id)
    if (
      task === null ||
      task.eventId !== actor.eventId ||
      task.contactId !== actor.contactId ||
      task.kind !== 'complete_form' ||
      task.formId === null ||
      task.formVersionId === null
    ) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    const [form, version, event] = await Promise.all([
      this.#forms.findById(task.formId),
      this.#versions.findById(task.formVersionId),
      this.#events.findById(task.eventId),
    ])
    if (form === null || version === null || event === null) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    const content = await this.#content.loadByVersion(task.eventId, version.id)
    return toFormDefinitionDto(form, event.slug, version, content, this.#clock.now())
  }

  /**
   * Completes one own task. Another speaker's task — or a task in another
   * event — is a safe 404, never a 403 that would confirm the id exists.
   * A form task completes only with answers that validate against its pinned
   * published version; the validated payload is persisted as the response.
   */
  async completeTask(
    actor: SubmitterActor,
    id: SpeakerTaskId,
    answers?: AnswerMap,
  ): Promise<SpeakerTaskDto> {
    assertSubmitterCapability(actor, 'portal')
    const now = this.#clock.now()
    const task = await this.#tasks.findById(id)
    if (task === null || task.eventId !== actor.eventId || task.contactId !== actor.contactId) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    // A rejected proposal's checklist is REFUSED here, not merely hidden by the
    // list read. The ids were handed out before the rejection and completion is
    // by id, so hiding alone left the work reachable — and completing anything
    // makes the verdict final (`#requireReversible`), which would let a rejected
    // speaker permanently strip the organizer of the ability to change their
    // mind in either direction. Same not-found as every other miss.
    const decision = await this.#submissions.findDecision(task.eventId, task.submissionId)
    if (decision?.outcome === 'rejected') {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    if (task.status === 'pending' && task.kind === 'submit_bio') {
      const contact = await this.#contacts.findById(actor.contactId)
      const bio = contact?.bio ?? null
      if (bio === null || bio.trim().length === 0) {
        throw new ValidationFailedError(
          'A persisted speaker bio is required before this task can complete',
          [],
        )
      }
    }
    if (task.status === 'pending' && task.kind === 'submit_headshot') {
      const upload = await this.#uploads.findOwn(actor.eventId, actor.contactId, 'headshot')
      if (upload === null) {
        throw new ValidationFailedError(
          'A stored headshot upload is required before this task can complete',
          [],
        )
      }
    }
    let response: AnswerMap | undefined
    if (task.kind === 'complete_form' && task.status === 'pending') {
      if (task.formVersionId === null) {
        throw new ApplicationError('not_found', `Task '${id}' not found`)
      }
      if (answers === undefined) {
        throw new ValidationFailedError('A form task requires answers to complete', [])
      }
      const content = await this.#content.loadByVersion(task.eventId, task.formVersionId)
      const issues = validateAnswersAgainstVersion(content, answers)
      if (issues.length > 0) {
        throw new ValidationFailedError('Answers failed server-side validation', issues)
      }
      response = answers
    }
    const completed = await this.#tasks.markCompleted(actor.eventId, id, now, response)
    if (completed === null) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    return toSpeakerTaskDto(completed, await this.#title(completed.submissionId, new Map()))
  }

  /**
   * The calling speaker's OWN accepted submissions, as ids. Acceptance is a
   * record rather than a status column, so this is the only read that can tell
   * a speaker-facing surface a proposal was accepted. It is scoped twice — to
   * the actor's event and to the submissions the actor owns — so it can never
   * disclose another speaker's decision.
   */
  async listAcceptedOwnSubmissionIds(actor: SubmitterActor): Promise<readonly SubmissionId[]> {
    assertSubmitterCapability(actor, 'portal')
    const [own, rejected] = await Promise.all([
      this.#submissions.listByOwner(actor.eventId, actor.contactId),
      this.#rejectedSubmissionIds(actor.eventId),
    ])
    const acceptances = await Promise.all(
      own.map((submission) => this.#tasks.findAcceptance(actor.eventId, submission.id)),
    )
    return own.flatMap((submission, index) =>
      acceptances[index] === null || rejected.has(submission.id) ? [] : [submission.id],
    )
  }

  /** The submissions of one event whose STANDING verdict is a rejection. */
  async #rejectedSubmissionIds(eventId: EventId): Promise<ReadonlySet<SubmissionId>> {
    const decisions = await this.#submissions.listDecisionsByEvent(eventId)
    return new Set(
      decisions
        .filter((decision) => decision.outcome === 'rejected')
        .map((decision) => decision.submissionId),
    )
  }

  /** Organizer readiness aggregate over every accepted submission. */
  async readiness(_actor: OrganizerActor, eventId: EventId): Promise<EventReadinessDto> {
    const [allAcceptances, allTasks, rejected] = await Promise.all([
      this.#tasks.listAcceptancesByEvent(eventId),
      this.#tasks.listByEvent(eventId),
      this.#rejectedSubmissionIds(eventId),
    ])
    // A rejected proposal is not an accepted speaker with outstanding work: it
    // would otherwise sit in the readiness aggregate for ever at 0% and read as
    // a speaker who has gone quiet.
    const acceptances = allAcceptances.filter(
      (acceptance) => !rejected.has(acceptance.submissionId),
    )
    const tasks = allTasks.filter((task) => !rejected.has(task.submissionId))
    const acceptedSubmissions = await Promise.all(
      acceptances.map((acceptance) => this.#submissions.findById(acceptance.submissionId)),
    )
    const extras = await this.#assignmentExtras(eventId, acceptances)
    const submissions = acceptances.map((acceptance, index): SubmissionReadinessDto => {
      const own = tasks.filter((task) => task.submissionId === acceptance.submissionId)
      const extra = extras.get(acceptance.submissionId) ?? { total: 0, completed: 0 }
      return toSubmissionReadinessDto(
        acceptance.submissionId,
        acceptedSubmissions[index]?.title ?? '',
        own,
        extra,
      )
    })
    const extraTotals = [...extras.values()].reduce(
      (sum, extra) => ({
        total: sum.total + extra.total,
        completed: sum.completed + extra.completed,
      }),
      { total: 0, completed: 0 },
    )
    const totals = readinessFromTasksAndAssignments(tasks, extraTotals)
    return {
      eventId,
      acceptedSubmissions: acceptances.length,
      totalTasks: totals.totalTasks,
      completedTasks: totals.completedTasks,
      percentComplete: totals.percentComplete,
      submissions,
    }
  }

  async #assignmentExtras(
    eventId: EventId,
    acceptances: readonly { readonly submissionId: SubmissionId }[],
  ): Promise<ReadonlyMap<SubmissionId, { readonly total: number; readonly completed: number }>> {
    const extras = new Map<SubmissionId, { readonly total: number; readonly completed: number }>()
    if (this.#programme === null) return extras
    const assignments = await this.#programme.listAssignments(eventId)
    const assigneesByAssignment = await Promise.all(
      assignments.map((assignment) => this.#programme!.listAssignees(assignment.id)),
    )
    for (const acceptance of acceptances) {
      const contributors = await this.#submissions.listContributorsBySubmission(
        eventId,
        acceptance.submissionId,
      )
      const contributorIds = new Set(contributors.map((contributor) => contributor.contactId))
      let total = 0
      let completed = 0
      for (const assignees of assigneesByAssignment) {
        const extra = extraReadinessFromAssignments(contributorIds, assignees)
        total += extra.total
        completed += extra.completed
      }
      extras.set(acceptance.submissionId, { total, completed })
    }
    return extras
  }

  async #title(submissionId: SubmissionId, cache: Map<SubmissionId, string>): Promise<string> {
    const cached = cache.get(submissionId)
    if (cached !== undefined) return cached
    const submission: ProposalSubmission | null = await this.#submissions.findById(submissionId)
    const title = submission?.title ?? ''
    cache.set(submissionId, title)
    return title
  }
}
