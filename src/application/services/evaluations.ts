import type { ContributorDto } from '../dtos/submission.dto'
import type { Contact, ContactId } from '../../domain/contact'
import type {
  EvaluationAssignment,
  EvaluationCriterion,
  EvaluationRound,
  EvaluationRoundId,
  EvaluationScore,
  RoundCriterion,
  RoundCriterionKind,
  RoundScore,
} from '../../domain/evaluation'
import type { EventId } from '../../domain/event'
import type { SubmissionId } from '../../domain/submission'
import {
  computeWeightedTotals,
  evaluationRoundWeights,
  isValidCriterionPosition,
  isValidCriterionWeight,
  isValidEvaluationRating,
  selectCurrentRound,
  selectDefaultCriterion,
  selectOpenRound,
  selectRoundAssignments,
  isAnswerValidFor,
  isRoundCriterionKind,
  weightedRoundAverageCentis,
  distributeAssignments,
  roundStateOf,
  selectQueueAssignments,
  selectSurfaceAssignments,
  snapshotCriterionWeights,
  type WeightedScore,
} from '../../domain/evaluation'
import { isValidEmailAddress, normalizeEmail } from '../../domain/invariants/email'
import { isValidUtcInstant } from '../../domain/invariants/time'
import type { OrganizerActor, SubmitterActor } from '../actors'
import type {
  EvaluationAssignmentDto,
  EvaluationCriterionDto,
  EvaluationCriterionSummaryDto,
  EvaluationPreviousRoundDto,
  EvaluationResultRowDto,
  EvaluationReviewDto,
  EvaluationRoundDto,
  EvaluationRoundSummaryDto,
  EvaluationRowDto,
  EvaluationSummaryDto,
} from '../dtos/evaluation.dto'
import {
  toEvaluationAssignmentDto,
  toEvaluationCriterionDto,
  toEvaluationRoundDto,
} from '../dtos/evaluation.dto'
import { ApplicationError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { CapturedMessageRepository } from '../ports/captured-message-repository'
import type { EvaluationRepository } from '../ports/evaluation-repository'
import type { SubmissionRepository } from '../ports/submission-repository'

/** One weighted criterion as the organizer defines it. */
export interface CriterionInput {
  readonly name: string
  readonly weight: number
  readonly position: number
}

export interface DefineCriteriaInput {
  readonly criteria: readonly CriterionInput[]
}

export interface OpenRoundInput {
  readonly number: number
  readonly name: string
}

export interface ConfigureRoundInput {
  readonly name: string
  readonly opensAt?: string | null
  readonly closesAt?: string | null
  readonly anonymize?: boolean
}

/** One proposed scorecard question, exactly as the organizer surface sends it. */
export interface RoundCriterionInput {
  readonly label: string
  readonly kind: string
  readonly weight?: number | null
  readonly scale?: { readonly min: number; readonly max: number } | null
  readonly options?: readonly string[] | null
}

/** One scorecard question as every surface reads it back. */
export interface RoundCriterionDto {
  readonly id: string
  readonly label: string
  readonly kind: RoundCriterionKind
  readonly weight: number | null
  readonly position: number
  readonly scale: { readonly min: number; readonly max: number } | null
  readonly options: readonly string[] | null
}

function toRoundCriterionDto(criterion: RoundCriterion): RoundCriterionDto {
  return {
    id: criterion.id,
    label: criterion.label,
    kind: criterion.kind,
    weight: criterion.weight,
    position: criterion.position,
    scale: criterion.scale,
    options: criterion.options,
  }
}

/**
 * A date the organizer typed, or the absence of one.
 *
 * Returns the canonical instant, `null` for "no date", or the sentinel
 * 'invalid' — which the caller refuses. Coercing an unparseable date to null
 * would silently clear a window the organizer believed they had set.
 */
function normalizeInstant(value: string | null | undefined): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return 'invalid'
  return isValidUtcInstant(value) ? value : 'invalid'
}

export interface AddCommitteeMemberInput {
  readonly email: string
  /** Only used when the contact does not exist yet; never overwrites a name. */
  readonly name?: string
}

/** One seat on an event's committee, as the organizer surface reads it back. */
export interface CommitteeMemberDto {
  readonly contactId: ContactId
  readonly email: string
  readonly name: string
  readonly addedAt: string
  /** False when the seat was already taken — the idempotent repeat. */
  readonly created: boolean
}

/**
 * One roster row: the seat, plus the only two numbers an organizer actually
 * asks about it.
 *
 * A list of names is a phone book. "Who still owes me reviews" is the question
 * a programme chair has, so the workload travels with the seat rather than
 * living one click away on another screen. Both counts are always numbers,
 * never absent — a member with nothing assigned is a real and common state, and
 * zero says so where a missing field would render as a blank.
 */
export interface CommitteeRosterEntryDto {
  readonly contactId: ContactId
  readonly email: string
  readonly name: string
  readonly addedAt: string
  /** Submissions this member has been given to read, in this event. */
  readonly assignedCount: number
  /** How many of those they have actually scored. Never exceeds `assignedCount`. */
  readonly completedCount: number
}

/** How an organizer wants a round's reading shared out. */
export interface DistributeRoundInput {
  /** Most proposals any one reviewer may end up holding. Null means no ceiling. */
  readonly perReviewerCap?: number | null
  /** Share out only this track's proposals; absent or empty means all of them. */
  readonly track?: string | null
  /**
   * How many reviewers each proposal should end up with. A TARGET, not an
   * increment: pressing the button twice does not double the committee's
   * reading, which is what makes it safe to press when unsure.
   */
  readonly readersPerSubmission?: number
}

/** What a share-out actually did, in the terms an organizer asked in. */
export interface DistributeRoundResultDto {
  readonly assigned: number
  readonly reviewers: number
  readonly considered: number
  /** Proposals still with no reader — a cap set too low, or a track nobody reads. */
  readonly unassigned: number
}

/** Which piece of reading a reviewer is stepping back from. */
export interface RecuseInput {
  readonly submissionId: SubmissionId
  /** Absent means the one round they hold it in, which is the usual case. */
  readonly roundId?: EvaluationRoundId
}

/** Which reviewers to nudge; empty or absent means everyone who is behind. */
export interface RemindReviewersInput {
  readonly contactIds?: readonly ContactId[]
}

/** What the nudge did, in the terms an organizer asked in. */
export interface RemindReviewersResultDto {
  readonly reminded: number
  /** Skipped because they owe nothing — reported, never counted as sent. */
  readonly upToDate: number
}

export interface AssignEvaluatorInput {
  readonly evaluatorEmail: string
  /** Defaults to the live round: the highest-numbered open round. */
  readonly roundId?: EvaluationRoundId
}

/**
 * Exactly the body the evaluator surface posts.
 *
 * `comments` is a partial update: omit the key and the stored justification is
 * left exactly as it was, send an empty string or null to clear it. A
 * rating-only edit must never be able to destroy words the evaluator wrote.
 */
export interface SubmitEvaluationInput {
  readonly submissionId: SubmissionId
  /**
   * Which round is being answered. A reviewer holding one proposal in two
   * rounds is answering two different scorecards, so the submission alone no
   * longer says where an answer belongs. Omitted by a client that knows only
   * one round, which is every caller written before rounds had scorecards: the
   * live round then stands, exactly as it always did.
   */
  readonly roundId?: EvaluationRoundId
  /** The legacy single rating; unused when the round has a typed scorecard. */
  readonly rating?: number
  readonly comments?: string | null
  /** One entry per answered question, when the round carries a scorecard. */
  readonly answers?: readonly { readonly criterionId: string; readonly value: unknown }[]
}

/**
 * Committee evaluation core.
 *
 * Organizer side: weighted criteria, numbered review rounds, evaluator
 * assignments resolved from an email, and the weighted totals of one
 * submission. Evaluator side: the rows for the submissions the calling
 * contact is assigned to, and one idempotent score per submission.
 *
 * Two rules hold everywhere. The acting identity always comes from a typed
 * actor, never from a body or a path parameter; and an evaluator can only
 * ever read or write through an assignment that exists in their own event,
 * so another committee member's work is invisible rather than merely denied.
 */
export class EvaluationService {
  readonly #submissions: SubmissionRepository
  readonly #contacts: ContactRepository
  readonly #evaluations: EvaluationRepository
  readonly #clock: Clock
  readonly #messages: CapturedMessageRepository

  constructor(
    submissions: SubmissionRepository,
    contacts: ContactRepository,
    evaluations: EvaluationRepository,
    clock: Clock,
    messages: CapturedMessageRepository,
  ) {
    this.#submissions = submissions
    this.#contacts = contacts
    this.#evaluations = evaluations
    this.#clock = clock
    this.#messages = messages
  }

  /**
   * Defines the event's weighted criteria. A criterion is identified by its
   * name: redefining one keeps its id (and therefore every score already
   * recorded against it) and only moves weight and position. Criteria are
   * never removed here, because removing one would strand recorded scores.
   *
   * For the same reason the default criterion — the single one the evaluator
   * surface scores — cannot be moved off a criterion that already carries
   * scores. Inserting a criterion ahead of it strands those ratings exactly as
   * a removal would: the evaluators who gave them would be told they had not
   * scored, and their abandoned ratings would still be counted in the weighted
   * total beside whatever they gave next.
   */
  async defineCriteria(
    _actor: OrganizerActor,
    eventId: EventId,
    input: DefineCriteriaInput,
  ): Promise<readonly EvaluationCriterionDto[]> {
    if (input.criteria.length === 0) {
      throw new ApplicationError('validation_failed', 'At least one criterion is required')
    }
    const names = new Set<string>()
    const parsed: CriterionInput[] = []
    for (const criterion of input.criteria) {
      const name = typeof criterion.name === 'string' ? criterion.name.trim() : ''
      if (name.length === 0) {
        throw new ApplicationError('validation_failed', 'A criterion name is required')
      }
      if (names.has(name)) {
        throw new ApplicationError('validation_failed', 'Criterion names must be unique')
      }
      if (!isValidCriterionWeight(criterion.weight)) {
        throw new ApplicationError('validation_failed', 'A criterion weight must be a whole number')
      }
      if (!isValidCriterionPosition(criterion.position)) {
        throw new ApplicationError(
          'validation_failed',
          'A criterion position must be a whole number',
        )
      }
      names.add(name)
      parsed.push({ name, weight: criterion.weight, position: criterion.position })
    }

    const [current, existing] = await Promise.all([
      this.#evaluations.listCriteria(eventId),
      Promise.all(
        parsed.map((criterion) => this.#evaluations.findCriterionByName(eventId, criterion.name)),
      ),
    ])
    const resolved: EvaluationCriterion[] = parsed.map((criterion, index) => {
      const stored = existing[index]
      return {
        id: stored?.id ?? crypto.randomUUID(),
        eventId,
        name: criterion.name,
        weight: criterion.weight,
        position: criterion.position,
      }
    })
    await this.#requireStableDefault(eventId, current, resolved)

    await Promise.all(resolved.map((criterion) => this.#evaluations.saveCriterion(criterion)))
    return this.listCriteria(_actor, eventId)
  }

  /**
   * Refuses a redefinition that would hand the default to another criterion
   * while the current default still carries scores. Only the scored case is
   * refused: with nothing recorded yet the organizer may order the criteria
   * however they like.
   */
  async #requireStableDefault(
    eventId: EventId,
    current: readonly EvaluationCriterion[],
    resolved: readonly EvaluationCriterion[],
  ): Promise<void> {
    const before = selectDefaultCriterion(current)
    if (before === null) return
    const touched = new Set(resolved.map((criterion) => criterion.name))
    const after = selectDefaultCriterion([
      ...current.filter((criterion) => !touched.has(criterion.name)),
      ...resolved,
    ])
    if (after === null || after.id === before.id) return
    const scored = await this.#evaluations.countScoresByCriterion(eventId, before.id)
    if (scored === 0) return
    throw new ApplicationError(
      'conflict',
      `Criterion '${before.name}' already carries scores and must stay the default`,
    )
  }

  async listCriteria(
    _actor: OrganizerActor,
    eventId: EventId,
  ): Promise<readonly EvaluationCriterionDto[]> {
    const criteria = await this.#evaluations.listCriteria(eventId)
    return criteria.map(toEvaluationCriterionDto)
  }

  /**
   * Whether this contact sits on the event's review committee.
   *
   * Takes no actor: the only caller is the sign-in exchange, which asks about
   * the identity it has just proven in order to decide where to send them. It
   * reads no evaluation content, so it discloses nothing an evaluator could
   * not already learn by opening the surface.
   */
  async isOnCommittee(eventId: EventId, contactId: ContactId): Promise<boolean> {
    return (await this.#evaluations.findCommitteeMember(eventId, contactId)) !== null
  }

  /**
   * Seats a reviewer on ONE event's committee, by email, whether or not that
   * person has ever used the product.
   *
   * An organizer picks their committee before the committee turns up; requiring
   * an existing contact meant they could only invite people who had already
   * signed in, which is the wrong way round. The contact is created on the same
   * email key the sign-in path uses, so the person the organizer invited and
   * the person who later follows a magic link are one identity.
   *
   * Least privilege: the seat is a row in ONE event, and it grants nothing but
   * reading that event's review surface. It is not a role on the contact.
   */
  async addCommitteeMember(
    _actor: OrganizerActor,
    eventId: EventId,
    input: AddCommitteeMemberInput,
  ): Promise<CommitteeMemberDto> {
    const email = normalizeEmail(typeof input.email === 'string' ? input.email : '')
    if (!isValidEmailAddress(email)) {
      throw new ApplicationError('validation_failed', 'A valid reviewer email is required')
    }
    const contact = await this.#ensureContact(email, input.name)
    const existing = await this.#evaluations.findCommitteeMember(eventId, contact.id)
    const member = await this.#evaluations.saveCommitteeMember({
      eventId,
      contactId: contact.id,
      addedAt: existing?.addedAt ?? this.#clock.now(),
    })
    return {
      contactId: contact.id,
      email: contact.email,
      name: contact.name,
      addedAt: member.addedAt,
      created: existing === null,
    }
  }

  /**
   * Rewrites one round's configuration: what it is called, when it runs, and
   * whether reviewers are hidden from one another.
   *
   * The window is validated the way every other window in this product is —
   * canonical UTC, and a close strictly after an open — so a round cannot be
   * given a shape the rest of the app would have to interpret. A refused
   * configuration changes nothing at all rather than landing the half of it
   * that happened to be valid.
   */
  async configureRound(
    _actor: OrganizerActor,
    eventId: EventId,
    roundId: EvaluationRoundId,
    input: ConfigureRoundInput,
  ): Promise<EvaluationRoundDto> {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (name.length === 0) {
      throw new ApplicationError('validation_failed', 'A round name is required')
    }
    const opensAt = normalizeInstant(input.opensAt)
    const closesAt = normalizeInstant(input.closesAt)
    if (opensAt === 'invalid' || closesAt === 'invalid') {
      throw new ApplicationError('validation_failed', 'A round date must be a UTC instant')
    }
    if (opensAt !== null && closesAt !== null && closesAt <= opensAt) {
      throw new ApplicationError('validation_failed', 'A round must close after it opens')
    }
    const configured = await this.#evaluations.configureRound(eventId, roundId, {
      name,
      opensAt,
      closesAt,
      anonymize: input.anonymize === true,
    })
    if (configured === null) {
      // Absent and belonging-to-another-event are the same safe answer.
      throw new ApplicationError('not_found', `Round '${roundId}' not found`)
    }
    return toEvaluationRoundDto(configured)
  }

  /** One round's scorecard, in the order the organizer arranged it. */
  async getRoundScorecard(
    _actor: OrganizerActor,
    eventId: EventId,
    roundId: EvaluationRoundId,
  ): Promise<readonly RoundCriterionDto[]> {
    await this.#requireRound(eventId, roundId)
    return (await this.#evaluations.listRoundCriteria(eventId, roundId)).map(toRoundCriterionDto)
  }

  /**
   * Replaces a round's scorecard.
   *
   * Every criterion is validated before ANY of them is written, so a scorecard
   * with one bad question is refused whole rather than saved up to the point it
   * went wrong — a half-saved rubric is one the organizer would have to
   * discover by reading it back.
   */
  async putRoundScorecard(
    _actor: OrganizerActor,
    eventId: EventId,
    roundId: EvaluationRoundId,
    input: readonly RoundCriterionInput[],
  ): Promise<readonly RoundCriterionDto[]> {
    await this.#requireRound(eventId, roundId)
    const criteria: RoundCriterion[] = input.map((candidate, index) =>
      this.#parseCriterion(candidate, index, eventId, roundId),
    )
    const stored = await this.#evaluations.replaceRoundCriteria(eventId, roundId, criteria)
    return stored.map(toRoundCriterionDto)
  }

  /**
   * Shares a round's unread proposals out among its reviewers in one action.
   *
   * Assigning one proposal to one reviewer at a time is fine for a committee
   * reading five and unusable for one reading two hundred, which is the point
   * at which a programme chair reaches for a spreadsheet instead of the tool.
   *
   * WHO reads is the round's pool when it has one, and the whole committee when
   * it does not — a round nobody has narrowed is a round everybody is in, which
   * is what an organizer who never opened the pool control means. This is also
   * what finally gives the pool teeth: until now it persisted and decided
   * nothing.
   *
   * WHAT is shared out can be narrowed to a single track, because a committee
   * usually splits its reading by subject and the alternative is the organizer
   * filtering by eye. A proposal already on someone's list is never handed to
   * them twice, and one with no eligible reviewer left is reported unassigned
   * rather than forced past a cap.
   */
  async distributeRound(
    _actor: OrganizerActor,
    eventId: EventId,
    roundId: EvaluationRoundId,
    input: DistributeRoundInput,
  ): Promise<DistributeRoundResultDto> {
    const round = await this.#requireRound(eventId, roundId)
    if (round.status !== 'open') {
      throw new ApplicationError('conflict', 'That review round is closed')
    }
    const cap = input.perReviewerCap ?? null
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
      throw new ApplicationError('validation_failed', 'A cap must be a whole number of at least 1')
    }
    const readers = input.readersPerSubmission ?? 1
    if (!Number.isInteger(readers) || readers < 1) {
      throw new ApplicationError(
        'validation_failed',
        'Each proposal needs at least one reviewer',
      )
    }

    const [pool, roster] = await Promise.all([
      this.#evaluations.listRoundPool(eventId, roundId),
      this.#evaluations.listCommitteeRoster(eventId),
    ])
    const eligible = pool.length > 0 ? pool : roster.map((member) => member.contactId)
    if (eligible.length === 0) {
      throw new ApplicationError('conflict', 'This round has no reviewers to share the reading out')
    }

    const track = typeof input.track === 'string' ? input.track.trim() : ''
    const submissions = (await this.#submissions.listByEvent(eventId)).filter(
      (submission) => track === '' || submission.answers['track'] === track,
    )

    // What everyone already holds IN THIS ROUND, so the cap counts the work an
    // organizer assigned by hand and a second run keeps levelling rather than
    // starting from zero.
    const existing = await Promise.all(
      submissions.map((submission) =>
        this.#evaluations.listAssignmentsBySubmission(eventId, submission.id),
      ),
    )
    const held = new Map<ContactId, number>(eligible.map((contactId) => [contactId, 0]))
    const subjects = submissions.map((submission, index) => {
      const excluded = new Set<ContactId>()
      for (const assignment of existing[index] ?? []) {
        if (assignment.roundId !== roundId) continue
        excluded.add(assignment.evaluatorContactId)
        held.set(assignment.evaluatorContactId, (held.get(assignment.evaluatorContactId) ?? 0) + 1)
      }
      return { submissionId: submission.id, excluded }
    })

    const pairings = distributeAssignments(
      eligible.map((contactId) => ({ contactId, held: held.get(contactId) ?? 0 })),
      subjects,
      cap,
      readers,
    )

    const now = this.#clock.now()
    for (const pairing of pairings) {
      await this.#evaluations.saveAssignment({
        id: crypto.randomUUID(),
        eventId,
        roundId,
        submissionId: pairing.submissionId,
        evaluatorContactId: pairing.contactId,
        createdAt: now,
        recusedAt: null,
      })
    }

    // "Unassigned" has to mean nobody is reading it, not merely that this run
    // added nothing: a proposal the organizer had already assigned by hand
    // gains no pairing here and is not a gap. Counted as those left with no
    // reader at all, so a cap set too low reports honestly instead of hiding
    // behind a total.
    const gained = new Map<SubmissionId, number>()
    for (const pairing of pairings) {
      gained.set(pairing.submissionId, (gained.get(pairing.submissionId) ?? 0) + 1)
    }
    const unassigned = subjects.filter(
      (subject) => subject.excluded.size + (gained.get(subject.submissionId) ?? 0) < readers,
    ).length

    return {
      assigned: pairings.length,
      reviewers: eligible.length,
      considered: submissions.length,
      unassigned,
    }
  }

  /**
   * Nudges the reviewers who still owe reviews.
   *
   * The roster already knows who is behind — it is the only screen that does —
   * so the nudge belongs next to the number rather than on a mail screen an
   * organizer would have to cross-reference by hand.
   *
   * Everyone up to date is skipped rather than mailed, and the count of each is
   * reported: an organizer who nudges a committee that has finished should be
   * told nobody needed it, not shown a success message that means nothing.
   *
   * Unlike an acceptance, a reminder is deliberately repeatable. Nudging twice
   * is a thing programme chairs do on purpose as a deadline approaches, so the
   * message is not keyed to a single delivery — the log keeps every nudge, and
   * when it was sent.
   */
  async remindReviewers(
    _actor: OrganizerActor,
    eventId: EventId,
    input: RemindReviewersInput = {},
  ): Promise<RemindReviewersResultDto> {
    const roster = await this.#evaluations.listCommitteeRoster(eventId)
    const only = input.contactIds
    const chosen =
      only === undefined || only.length === 0
        ? roster
        : roster.filter((member) => only.includes(member.contactId))

    const outstanding = chosen.filter(
      (member) => member.assignedCount > member.completedCount && member.email !== '',
    )
    const now = this.#clock.now()
    for (const member of outstanding) {
      const owed = member.assignedCount - member.completedCount
      await this.#messages.save({
        id: crypto.randomUUID(),
        eventId,
        toEmail: member.email,
        subject: 'A reminder about the proposals waiting for your review',
        // The number is the whole point of the message: "you have reviews
        // outstanding" tells a reviewer nothing they can act on, and "2 of 3"
        // tells them how much of an evening it will take.
        body: `You have ${owed} of ${member.assignedCount} review(s) still to complete. Your queue is at /evaluations.`,
        createdAt: now,
        kind: 'reminder',
        // No submission: this is about their queue, not about one proposal —
        // which is also what tells the two kinds of reminder apart in the log.
        submissionId: null,
      })
    }
    return { reminded: outstanding.length, upToDate: chosen.length - outstanding.length }
  }

  /** The committee members reading in this round. */
  async getRoundPool(
    _actor: OrganizerActor,
    eventId: EventId,
    roundId: EvaluationRoundId,
  ): Promise<readonly { readonly contactId: ContactId }[]> {
    await this.#requireRound(eventId, roundId)
    return (await this.#evaluations.listRoundPool(eventId, roundId)).map((contactId) => ({
      contactId,
    }))
  }

  /**
   * Sets which committee members read in this round.
   *
   * A pool NARROWS the committee; it never grants. Everyone named has to hold a
   * seat, because the seat is what grants access to the event's review surface
   * at all — pooling a stranger into a round would otherwise be a way around
   * the committee entirely.
   */
  async putRoundPool(
    _actor: OrganizerActor,
    eventId: EventId,
    roundId: EvaluationRoundId,
    contactIds: readonly ContactId[],
  ): Promise<readonly { readonly contactId: ContactId }[]> {
    await this.#requireRound(eventId, roundId)
    const seats = await Promise.all(
      contactIds.map((contactId) => this.#evaluations.findCommitteeMember(eventId, contactId)),
    )
    if (seats.some((seat) => seat === null)) {
      throw new ApplicationError(
        'validation_failed',
        'Only committee members can be pooled into a round',
      )
    }
    await this.#evaluations.replaceRoundPool(eventId, roundId, contactIds, this.#clock.now())
    return contactIds.map((contactId) => ({ contactId }))
  }

  async #requireRound(eventId: EventId, roundId: EvaluationRoundId): Promise<EvaluationRound> {
    const round = await this.#evaluations.findRoundById(roundId)
    if (round === null || round.eventId !== eventId) {
      throw new ApplicationError('not_found', `Round '${roundId}' not found`)
    }
    return round
  }

  /** One proposed criterion, refused rather than coerced when it is malformed. */
  #parseCriterion(
    candidate: RoundCriterionInput,
    index: number,
    eventId: EventId,
    roundId: EvaluationRoundId,
  ): RoundCriterion {
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
    if (label.length === 0) {
      throw new ApplicationError('validation_failed', 'A criterion label is required')
    }
    if (!isRoundCriterionKind(candidate.kind)) {
      throw new ApplicationError('validation_failed', 'Unknown criterion kind')
    }
    const kind = candidate.kind
    // Weight belongs to a rating and to nothing else: an option and a paragraph
    // cannot be multiplied, so a weight on them would be a number the average
    // has to remember to skip.
    if (kind === 'rating') {
      if (
        typeof candidate.weight !== 'number' ||
        !Number.isInteger(candidate.weight) ||
        candidate.weight < 1
      ) {
        throw new ApplicationError('validation_failed', 'A rating criterion needs a whole weight')
      }
    } else if (candidate.weight !== null && candidate.weight !== undefined) {
      throw new ApplicationError('validation_failed', 'Only a rating criterion carries a weight')
    }
    const scale = kind === 'rating' ? (candidate.scale ?? { min: 1, max: 5 }) : null
    if (
      scale !== null &&
      (!Number.isInteger(scale.min) || !Number.isInteger(scale.max) || scale.max <= scale.min)
    ) {
      throw new ApplicationError('validation_failed', 'A rating scale must run upwards')
    }
    const options = kind === 'select' ? (candidate.options ?? []) : null
    if (
      options !== null &&
      (options.length === 0 || options.some((option) => option.trim() === ''))
    ) {
      throw new ApplicationError('validation_failed', 'A choice criterion needs options')
    }
    return {
      id: crypto.randomUUID(),
      eventId,
      roundId,
      position: index,
      label,
      kind,
      weight: kind === 'rating' ? (candidate.weight as number) : null,
      scale,
      options,
    }
  }

  /**
   * The event's committee, with each member's workload beside their seat.
   *
   * Ordered by when the seat was taken, so the roster reads as the committee was
   * assembled rather than by an id nobody chose.
   */
  async listCommittee(
    _actor: OrganizerActor,
    eventId: EventId,
  ): Promise<readonly CommitteeRosterEntryDto[]> {
    // One repository read. This was assembled per member from primitives and
    // cost a query per member plus one per assignment — 17 statements for a
    // seven-person committee with nothing assigned, and hundreds for a real
    // one. Counting rows is the database's job.
    return this.#evaluations.listCommitteeRoster(eventId)
  }

  /**
   * Gives up one seat.
   *
   * Deliberately idempotent and deliberately narrow: it removes the SEAT and
   * nothing else. The contact survives (they may be a speaker on another event,
   * and they are a person regardless), and every score they recorded survives —
   * an average the committee already reached does not become untrue because
   * somebody later left it. Their assignments keep pointing at them for the same
   * reason, so the history of who read what stays answerable.
   */
  async removeCommitteeMember(
    _actor: OrganizerActor,
    eventId: EventId,
    contactId: ContactId,
  ): Promise<void> {
    await this.#evaluations.deleteCommitteeMember(eventId, contactId)
  }

  /**
   * The contact behind an email, created if nobody has ever used it. The
   * fallback name is the local part rather than an empty string, so a roster
   * an organizer has not annotated still reads as people.
   */
  async #ensureContact(email: string, name: string | undefined): Promise<Contact> {
    const proposed = typeof name === 'string' ? name.trim() : ''
    return this.#contacts.ensureByEmail({
      id: crypto.randomUUID(),
      email,
      name: proposed.length > 0 ? proposed : (email.split('@')[0] ?? email),
      createdAt: this.#clock.now(),
    })
  }

  /**
   * Opens a numbered review round. Re-opening a round that is already open
   * returns it unchanged (idempotent retry); a round that has been closed is
   * a conflict, because open is not reachable from closed.
   */
  async openRound(
    _actor: OrganizerActor,
    eventId: EventId,
    input: OpenRoundInput,
  ): Promise<EvaluationRoundDto> {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!Number.isInteger(input.number) || input.number < 1) {
      throw new ApplicationError('validation_failed', 'A round number must be a whole number')
    }
    if (name.length === 0) {
      throw new ApplicationError('validation_failed', 'A round name is required')
    }
    const existing = await this.#evaluations.findRoundByNumber(eventId, input.number)
    if (existing !== null) {
      if (existing.status === 'closed') {
        throw new ApplicationError('conflict', 'That review round is closed')
      }
      return toEvaluationRoundDto(existing)
    }
    const round = await this.#evaluations.saveRound({
      id: crypto.randomUUID(),
      eventId,
      number: input.number,
      name,
      status: 'open',
      recordedWeights: null,
      // A new round is undated and open to everyone until an organizer says
      // otherwise; the columns exist so they can say so, not so every round
      // must.
      opensAt: null,
      closesAt: null,
      anonymize: false,
    })
    return toEvaluationRoundDto(round)
  }

  async listRounds(
    _actor: OrganizerActor,
    eventId: EventId,
  ): Promise<readonly EvaluationRoundDto[]> {
    const rounds = await this.#evaluations.listRounds(eventId)
    return rounds.map(toEvaluationRoundDto)
  }

  /**
   * Closes a round, recording the rubric it concluded under so its result can
   * never be re-weighted by a later change to the criteria. Closing an already
   * closed round is a no-op and keeps the rubric originally recorded.
   */
  async closeRound(
    _actor: OrganizerActor,
    eventId: EventId,
    roundId: EvaluationRoundId,
  ): Promise<EvaluationRoundDto> {
    const round = await this.#evaluations.findRoundById(roundId)
    if (round === null || round.eventId !== eventId) {
      throw new ApplicationError('not_found', `Round '${roundId}' not found`)
    }
    const criteria = await this.#evaluations.listCriteria(round.eventId)
    const closed = await this.#evaluations.closeRound(
      round.eventId,
      round.id,
      snapshotCriterionWeights(criteria),
    )
    if (closed === null) {
      throw new ApplicationError('not_found', `Round '${roundId}' not found`)
    }
    return toEvaluationRoundDto(closed)
  }

  /**
   * Assigns a committee evaluator to a submission for one round. The evaluator
   * is resolved from an email, and an email nobody has used yet becomes a
   * contact here rather than a refusal: an organizer handing out reading is
   * the same act of provisioning as seating someone on the committee, so it
   * cannot depend on whether that person has signed in first. Repeating the
   * same assignment returns the existing row rather than a second one.
   */
  async assign(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
    input: AssignEvaluatorInput,
  ): Promise<EvaluationAssignmentDto> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const email = normalizeEmail(
      typeof input.evaluatorEmail === 'string' ? input.evaluatorEmail : '',
    )
    if (!isValidEmailAddress(email)) {
      throw new ApplicationError('validation_failed', 'A valid evaluator email is required')
    }
    const contact = await this.#ensureContact(email, undefined)
    const round = await this.#resolveOpenRound(submission.eventId, input.roundId)

    // Giving someone a submission to read is what puts them on the committee,
    // so there is no second organizer step between assigning an evaluator and
    // that evaluator being able to open the surface.
    await this.#evaluations.saveCommitteeMember({
      eventId: submission.eventId,
      contactId: contact.id,
      addedAt: this.#clock.now(),
    })

    const existing = await this.#evaluations.findAssignment(
      submission.eventId,
      round.id,
      submission.id,
      contact.id,
    )
    if (existing !== null) {
      return toEvaluationAssignmentDto(existing, contact.email, contact.name)
    }
    const assignment = await this.#evaluations.saveAssignment({
      id: crypto.randomUUID(),
      eventId: submission.eventId,
      roundId: round.id,
      submissionId: submission.id,
      evaluatorContactId: contact.id,
      createdAt: this.#clock.now(),
      recusedAt: null,
    })
    return toEvaluationAssignmentDto(assignment, contact.email, contact.name)
  }

  /** Every committee assignment on one submission, oldest first. */
  async listAssignments(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly EvaluationAssignmentDto[]> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const [assignments, criteria, scores] = await Promise.all([
      this.#evaluations.listAssignmentsBySubmission(submission.eventId, submission.id),
      this.#evaluations.listCriteria(submission.eventId),
      this.#evaluations.listScoresBySubmission(submission.eventId, submission.id),
    ])
    const contacts = await Promise.all(
      assignments.map((assignment) => this.#contacts.findById(assignment.evaluatorContactId)),
    )
    const criterion = selectDefaultCriterion(criteria)
    return assignments.map((assignment, index) => {
      const contact = contacts[index]
      return toEvaluationAssignmentDto(
        assignment,
        contact?.email ?? '',
        contact?.name ?? '',
        ownScore(scores, assignment, criterion),
      )
    })
  }

  /**
   * Weighted totals for one submission, round by round.
   *
   * Every round the event has run reports its own result, and the headline
   * numbers are the current round's, named by `currentRoundId`. Two rules make
   * the numbers mean something. A round's total is built only from that
   * round's assignments, so a live slot is never averaged with a leftover
   * rating from a round that already finished — a figure belonging to neither
   * round is worse than no figure at all. And a closed round is weighted by
   * the rubric it recorded when it closed, so retuning the criteria for the
   * next round cannot rewrite a conclusion the committee already published.
   */
  /**
   * Every proposal of one event with what the committee scored it.
   *
   * The weighted total was reachable one submission at a time, so the question a
   * programme committee actually meets to answer — which proposals came out on
   * top — had no screen behind it. Reading a score by opening each proposal and
   * remembering it is not a ranking.
   *
   * The arithmetic is deliberately NOT reimplemented here: each row is the same
   * `weightedSummary` the detail page shows, so a total can never disagree with
   * itself depending on which screen an organizer is looking at. Sorting is the
   * caller's, and the row carries a comparable number so a table can order by it
   * in either direction.
   */
  async resultsForEvent(
    actor: OrganizerActor,
    eventId: EventId,
  ): Promise<readonly EvaluationResultRowDto[]> {
    const submissions = await this.#submissions.listByEvent(eventId)
    const [summaries, decisions, contributorLists] = await Promise.all([
      Promise.all(
        submissions.map((submission) => this.weightedSummary(actor, eventId, submission.id)),
      ),
      this.#submissions.listDecisionsByEvent(eventId),
      Promise.all(
        submissions.map(async (submission) => {
          const rows = await this.#submissions.listContributorsBySubmission(eventId, submission.id)
          // Names and roles both: a co-author is only visible on a results row if
          // the role travels with the name, and the role lives on the join while
          // the name lives on the contact.
          return Promise.all(
            rows.map(async (row): Promise<ContributorDto> => {
              const contact = await this.#contacts.findById(row.contactId)
              return {
                contactId: row.contactId,
                name: contact?.name ?? row.contactId,
                email: contact?.email ?? '',
                role: row.role,
                position: row.position,
              }
            }),
          )
        }),
      ),
    ])
    const outcomeBySubmission = new Map(
      decisions.map((decision) => [decision.submissionId, decision.outcome] as const),
    )
    return submissions.map((submission, index) => {
      const summary = summaries[index]
      // Null, not zero: nobody having scored it is not the same as it scoring
      // nothing, and a table that conflates them ranks an unread proposal below
      // a badly-reviewed one.
      const scored = summary !== undefined && summary.scoredCount > 0
      return {
        submissionId: submission.id,
        title: submission.title,
        weightedAverageCentis: scored ? (summary?.weightedAverageCentis ?? null) : null,
        assignmentCount: summary?.assignmentCount ?? 0,
        scoredCount: summary?.scoredCount ?? 0,
        // 'pending' rather than null: the domain's own vocabulary for a
        // proposal nobody has decided yet, so a table never has to guess whether
        // an absent value means undecided or means the field failed to load.
        decision: outcomeBySubmission.get(submission.id) ?? 'pending',
        contributors: contributorLists[index] ?? [],
      }
    })
  }

  async weightedSummary(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<EvaluationSummaryDto> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const [criteria, rounds, assignments, stored] = await Promise.all([
      this.#evaluations.listCriteria(submission.eventId),
      this.#evaluations.listRounds(submission.eventId),
      this.#evaluations.listAssignmentsBySubmission(submission.eventId, submission.id),
      this.#evaluations.listScoresBySubmission(submission.eventId, submission.id),
    ])

    // The evaluator identities the reviews need. Loaded once for the whole
    // summary rather than per round, because one member typically sits in
    // several rounds on the same submission.
    const evaluatorIds = [...new Set(assignments.map((a) => a.evaluatorContactId))]
    const evaluators = await Promise.all(evaluatorIds.map((id) => this.#contacts.findById(id)))
    const byContactId = new Map(
      evaluatorIds.map((id, index) => [id, evaluators[index] ?? null] as const),
    )
    const criterion = selectDefaultCriterion(criteria)
    // Typed answers, and the scorecards they answer, for every round that has
    // one. A round with a scorecard is summarised from ITS weights; a round
    // without keeps the event rubric it always used.
    const [typedAnswers, typedCards] = await Promise.all([
      this.#evaluations.listRoundScoresBySubmission(submission.eventId, submission.id),
      Promise.all(
        rounds.map(async (round) => ({
          roundId: round.id,
          criteria: await this.#evaluations.listRoundCriteria(submission.eventId, round.id),
        })),
      ),
    ])
    const cardByRound = new Map(typedCards.map((entry) => [entry.roundId, entry.criteria]))
    const roundSummaries = rounds.map((round) => {
      const card = cardByRound.get(round.id) ?? []
      if (card.length > 0) {
        return summarizeTypedRound(
          round,
          selectRoundAssignments(assignments, round.id),
          card,
          typedAnswers,
          byContactId,
        )
      }
      return summarizeRound(
        round,
        selectRoundAssignments(assignments, round.id),
        stored,
        criteria,
        criterion,
        byContactId,
      )
    })
    const current = selectCurrentRound(rounds)
    const headline = roundSummaries.find((entry) => entry.roundId === current?.id) ?? null

    return {
      submissionId: submission.id,
      eventId: submission.eventId,
      title: submission.title,
      currentRoundId: current?.id ?? null,
      assignmentCount: headline?.assignmentCount ?? 0,
      scoredCount: headline?.scoredCount ?? 0,
      scoreCount: headline?.scoreCount ?? 0,
      weightSum: headline?.weightSum ?? 0,
      weightedTotal: headline?.weightedTotal ?? 0,
      weightedAverageCentis: headline?.weightedAverageCentis ?? 0,
      criteria: headline?.criteria ?? emptyCriteriaBreakdown(criteria),
      reviews: headline?.reviews ?? [],
      rounds: roundSummaries,
    }
  }

  /**
   * The calling evaluator's own rows, one per assigned submission. A contact
   * with no assignment in the event is forbidden outright: the surface exists
   * only for the committee.
   *
   * A submission the evaluator holds in more than one round still yields a
   * single row — the row they can write — because a second row would carry the
   * same `submissionId` with a contradictory rating and nothing to tell the
   * two apart.
   */
  async listOwnEvaluations(actor: SubmitterActor): Promise<readonly EvaluationRowDto[]> {
    // The SEAT is the authority, always — not the presence of assignments.
    // Membership used to be checked only when the queue came back empty, so a
    // reviewer removed from the committee kept every assignment they already
    // had: the organizer was told access was revoked, and it was not. Their
    // assignments deliberately survive removal (the record of who read what),
    // which is exactly why those rows cannot be what grants access.
    await this.#requireCommitteeMember(actor)
    const assignments = await this.#evaluations.listAssignmentsByEvaluator(
      actor.eventId,
      actor.contactId,
    )
    if (assignments.length === 0) {
      // A committee member whose queue is empty is told it is empty; someone
      // who was never on the committee does not learn the surface exists.
      return []
    }
    const [criteria, rounds] = await Promise.all([
      this.#evaluations.listCriteria(actor.eventId),
      this.#evaluations.listRounds(actor.eventId),
    ])
    const criterion = selectDefaultCriterion(criteria)
    return Promise.all(
      // One row per submission AND round. A reviewer sitting on two rounds is
      // being asked two different sets of questions, and showing only the
      // newest round meant the round they were seated in never reached them.
      // Anything they have recused themselves from is gone from the queue —
      // the point of declaring a conflict is to stop being asked.
      selectQueueAssignments(
        assignments.filter((assignment) => assignment.recusedAt === null),
        rounds,
      ).map(async (assignment) => {
        // Each row asks whatever ITS round asks. Two rounds of one event may
        // carry different scorecards, so the shape is decided per assignment
        // rather than once for the whole queue.
        const roundCriteria = await this.#evaluations.listRoundCriteria(
          actor.eventId,
          assignment.roundId,
        )
        return roundCriteria.length > 0
          ? this.#toTypedRow(actor, assignment, roundCriteria, rounds)
          : this.#toRow(assignment, criterion, assignments, rounds)
      }),
    )
  }

  /**
   * Records the evaluator's rating for one assigned submission on the event's
   * default criterion. The write is an upsert keyed on the assignment and the
   * criterion, so re-submitting updates the single existing row.
   *
   * The assignment is chosen by the same rule the list uses, so a rating always
   * lands on the row the evaluator was shown.
   */
  async upsertScore(
    actor: SubmitterActor,
    input: SubmitEvaluationInput,
  ): Promise<EvaluationRowDto> {
    const [assignments, rounds] = await Promise.all([
      this.#requireAssignments(actor),
      this.#evaluations.listRounds(actor.eventId),
    ])
    // A named round is answered directly; without one the live round stands,
    // which is what every caller predating round scorecards means. Both resolve
    // to an assignment the caller actually holds, so naming a round they were
    // never put on is refused exactly like naming someone else's submission.
    // Reading they have stepped back from is set aside FIRST, so a reviewer who
    // recused themselves in one round can still answer another. Resolving over
    // every assignment and refusing afterwards would have let a recusal in the
    // newest round block a review they legitimately owe in an older one.
    const live = assignments.filter((candidate) => candidate.recusedAt === null)
    const matches = (candidate: EvaluationAssignment): boolean =>
      candidate.submissionId === input.submissionId &&
      (input.roundId === undefined || candidate.roundId === input.roundId)
    const assignment =
      input.roundId === undefined
        ? selectSurfaceAssignments(live, rounds).get(input.submissionId)
        : live.find(matches)
    if (assignment === undefined) {
      // Refused with the real reason rather than a flat "not yours", and
      // refused on the SERVER rather than merely hidden: a surface that stops
      // offering a control still receives whatever a stale tab sends.
      if (assignments.some(matches)) {
        throw new ApplicationError('conflict', 'You have stepped back from that proposal')
      }
      throw new ApplicationError('forbidden', 'You are not assigned to that submission')
    }

    // WHICH PATH IS LIVE is decided by the round, not by the request. A round
    // carrying its own typed scorecard takes typed answers; a round with none
    // — every round that existed before scorecards — keeps the single-rating
    // path and the scores already recorded against it.
    const roundCriteria = await this.#evaluations.listRoundCriteria(
      actor.eventId,
      assignment.roundId,
    )
    if (roundCriteria.length > 0) {
      return this.#recordTypedAnswers(actor, assignment, roundCriteria, input, rounds)
    }

    if (!isValidEvaluationRating(input.rating)) {
      throw new ApplicationError('validation_failed', 'A rating must be a whole number from 1 to 5')
    }
    const round = rounds.find((candidate) => candidate.id === assignment.roundId)
    // Status AND window. The organizer published a date; enforcing only the
    // lifecycle flag meant a reviewer could score a week after "reviewing
    // closes" and the committee would never know the total had moved.
    if (round === undefined || roundStateOf(round, this.#clock.now()) !== 'open') {
      throw new ApplicationError('conflict', 'That review round is not taking answers')
    }
    const criteria = await this.#evaluations.listCriteria(actor.eventId)
    const criterion = selectDefaultCriterion(criteria)
    if (criterion === null) {
      throw new ApplicationError('conflict', 'This event has no evaluation criteria yet')
    }

    const now = this.#clock.now()
    const existing = (
      await this.#evaluations.listScoresByAssignment(actor.eventId, assignment.id)
    ).find((score) => score.criterionId === criterion.id)
    await this.#evaluations.upsertScore({
      id: existing?.id ?? crypto.randomUUID(),
      eventId: actor.eventId,
      assignmentId: assignment.id,
      criterionId: criterion.id,
      rating: input.rating,
      comment: mergeComment(input.comments, existing?.comment ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    return this.#toRow(assignment, criterion, assignments, rounds)
  }

  /**
   * A reviewer declares a conflict of interest and steps back from one
   * proposal.
   *
   * The honest response to "I know this person" is to stop asking them, not to
   * let them score it anyway and hope. So the proposal leaves their queue: a
   * recused assignment is no longer something they can answer, and the write
   * path refuses it for the same reason the queue stops offering it.
   *
   * The assignment is kept rather than deleted. It is the record that this
   * reviewer was asked and stepped back, it is what stops a later share-out
   * handing them the same proposal to refuse a second time, and it is the row
   * any answer they had already recorded points at.
   *
   * Reversal is deliberately not offered here. Declaring a conflict is a
   * statement about a relationship, not a filter to toggle, and an organizer
   * who needs to undo one is having a conversation rather than clicking.
   */
  async recuse(actor: SubmitterActor, input: RecuseInput): Promise<void> {
    const assignments = await this.#requireAssignments(actor)
    const assignment = assignments.find(
      (candidate) =>
        candidate.submissionId === input.submissionId &&
        (input.roundId === undefined || candidate.roundId === input.roundId),
    )
    if (assignment === undefined) {
      throw new ApplicationError('forbidden', 'You are not assigned to that submission')
    }
    await this.#evaluations.recuseAssignment(actor.eventId, assignment.id, this.#clock.now())
  }

  /**
   * Records a reviewer's answers to a typed scorecard.
   *
   * Every answer is checked against the criterion it answers BEFORE any of them
   * is written, so a submission carrying one bad value is refused whole rather
   * than half-saved — a reviewer would otherwise have to reload to discover
   * which of their answers survived.
   */
  async #recordTypedAnswers(
    actor: SubmitterActor,
    assignment: EvaluationAssignment,
    criteria: readonly RoundCriterion[],
    input: SubmitEvaluationInput,
    rounds: readonly EvaluationRound[],
  ): Promise<EvaluationRowDto> {
    const round = rounds.find((candidate) => candidate.id === assignment.roundId)
    // Status AND window. The organizer published a date; enforcing only the
    // lifecycle flag meant a reviewer could score a week after "reviewing
    // closes" and the committee would never know the total had moved.
    if (round === undefined || roundStateOf(round, this.#clock.now()) !== 'open') {
      throw new ApplicationError('conflict', 'That review round is not taking answers')
    }
    const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]))
    const answers = input.answers ?? []
    for (const answer of answers) {
      const criterion = byId.get(answer.criterionId)
      if (criterion === undefined) {
        throw new ApplicationError('validation_failed', 'That question is not on this scorecard')
      }
      if (!isAnswerValidFor(criterion, answer.value)) {
        throw new ApplicationError(
          'validation_failed',
          `'${criterion.label}' was not answered validly`,
        )
      }
    }

    const now = this.#clock.now()
    const existing = await this.#evaluations.listRoundScoresByAssignment(
      actor.eventId,
      assignment.id,
    )
    for (const answer of answers) {
      const criterion = byId.get(answer.criterionId)
      if (criterion === undefined) continue
      const previous = existing.find((score) => score.criterionId === criterion.id)
      await this.#evaluations.saveRoundScore({
        id: previous?.id ?? crypto.randomUUID(),
        eventId: actor.eventId,
        assignmentId: assignment.id,
        criterionId: criterion.id,
        // A rating is a number and everything else is words: exactly one of
        // these columns carries the answer, so a reader never has to guess.
        valueNumber: criterion.kind === 'rating' ? (answer.value as number) : null,
        valueText: criterion.kind === 'rating' ? null : String(answer.value),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      })
    }
    return this.#toTypedRow(actor, assignment, criteria, rounds)
  }

  /** One queue row whose fields are the round's own questions. */
  async #toTypedRow(
    actor: SubmitterActor,
    assignment: EvaluationAssignment,
    criteria: readonly RoundCriterion[],
    rounds: readonly EvaluationRound[],
  ): Promise<EvaluationRowDto> {
    const [submission, stored] = await Promise.all([
      this.#submissions.findById(assignment.submissionId),
      this.#evaluations.listRoundScoresByAssignment(actor.eventId, assignment.id),
    ])
    const round = rounds.find((candidate) => candidate.id === assignment.roundId)
    const byCriterion = new Map(stored.map((score) => [score.criterionId, score]))
    const [speakerName, coSpeakers] = await Promise.all([
      this.#speakerNameFor(submission, round),
      this.#coSpeakersFor(submission, round),
    ])
    return {
      submissionId: assignment.submissionId,
      sessionTitle: submission?.title ?? '',
      speakerName,
      coSpeakers,
      anonymized: round?.anonymize === true,
      roundId: assignment.roundId,
      roundNumber: round?.number ?? 0,
      roundName: round?.name ?? '',
      roundStatus: round?.status ?? 'open',
      roundState: round === undefined ? 'closed' : roundStateOf(round, this.#clock.now()),
      // The legacy single-rating fields stay null on a typed round: the answers
      // live on `criteria`, and reporting a rating here would be inventing one.
      rating: null,
      comments: null,
      updatedAt: stored.reduce<string | null>(
        (latest, score) => (latest === null || score.updatedAt > latest ? score.updatedAt : latest),
        null,
      ),
      previousRounds: [],
      criteria: criteria.map((criterion) => {
        const answer = byCriterion.get(criterion.id)
        return {
          id: criterion.id,
          label: criterion.label,
          kind: criterion.kind,
          weight: criterion.weight,
          scale: criterion.scale,
          options: criterion.options,
          // Unanswered is null rather than absent, so the form renders an empty
          // field instead of guessing whether the question exists.
          value: answer === undefined ? null : (answer.valueNumber ?? answer.valueText),
        }
      }),
    }
  }

  /**
   * Whose proposal a reviewer is holding — or nothing at all in a blind round.
   *
   * Withheld HERE, on the server, rather than left to the screen to hide. A
   * name that reaches the browser has been disclosed however carefully it is
   * styled, and the whole point of a blind round is that the reviewer cannot
   * know. The round decides, so the same proposal is named in an open round and
   * anonymous in a blind one without either surface having to remember.
   */
  async #speakerNameFor(
    submission: { readonly ownerContactId: ContactId } | null,
    round: EvaluationRound | undefined,
  ): Promise<string | null> {
    if (submission === null || round === undefined || round.anonymize) return null
    const owner = await this.#contacts.findById(submission.ownerContactId)
    return owner?.name ?? null
  }

  /**
   * The other names on a proposal, or nothing at all in a blind round.
   *
   * Withheld on the SERVER beside the speaker's own name, and for the same
   * reason: a committee that hides the author and then lists their co-presenter
   * has not run a blind round, it has run a slower one. The primary is left out
   * because they are already the `speakerName` — repeating them would put one
   * person on the card twice.
   */
  async #coSpeakersFor(
    submission: { readonly id: SubmissionId; readonly eventId: EventId } | null,
    round: EvaluationRound | undefined,
  ): Promise<readonly { readonly name: string; readonly role: string }[]> {
    if (submission === null || round === undefined || round.anonymize) return []
    const contributors = await this.#submissions.listContributorsBySubmission(
      submission.eventId,
      submission.id,
    )
    const named = await Promise.all(
      contributors
        .filter((contributor) => contributor.role !== 'primary')
        .map(async (contributor) => ({
          contact: await this.#contacts.findById(contributor.contactId),
          role: contributor.role,
        })),
    )
    return named.flatMap((entry) =>
      entry.contact === null ? [] : [{ name: entry.contact.name, role: entry.role }],
    )
  }

  /** Forbidden unless this contact sits on the event's review committee. */
  async #requireCommitteeMember(actor: SubmitterActor): Promise<void> {
    const member = await this.#evaluations.findCommitteeMember(actor.eventId, actor.contactId)
    if (member === null) {
      throw new ApplicationError('forbidden', 'You are not on this review committee')
    }
  }

  /** Assignments of the calling evaluator; forbidden when there are none. */
  async #requireAssignments(actor: SubmitterActor): Promise<readonly EvaluationAssignment[]> {
    // Seat first, then work. Gating a WRITE on assignments alone let a removed
    // reviewer keep scoring — and overwrite ratings — on a committee they are
    // no longer part of, because their assignment rows outlive their seat.
    await this.#requireCommitteeMember(actor)
    const assignments = await this.#evaluations.listAssignmentsByEvaluator(
      actor.eventId,
      actor.contactId,
    )
    if (assignments.length === 0) {
      throw new ApplicationError('forbidden', 'You have no evaluation assignments')
    }
    return assignments
  }

  /** Resolves the requested round, or the event's live (highest open) round. */
  async #resolveOpenRound(
    eventId: EventId,
    roundId: EvaluationRoundId | undefined,
  ): Promise<EvaluationRound> {
    if (roundId !== undefined) {
      const round = await this.#evaluations.findRoundById(roundId)
      if (round === null || round.eventId !== eventId) {
        throw new ApplicationError('not_found', `Round '${roundId}' not found`)
      }
      if (round.status !== 'open') {
        throw new ApplicationError('conflict', 'That review round is closed')
      }
      return round
    }
    const open = selectOpenRound(await this.#evaluations.listRounds(eventId))
    if (open === null) {
      throw new ApplicationError('conflict', 'This event has no open review round')
    }
    return open
  }

  /**
   * Evaluator row for one assignment on the event's default criterion.
   *
   * The row says which round it belongs to and carries what this evaluator
   * recorded in their earlier rounds on the same submission, so a new round
   * never asks anyone to score blind against their own past opinion. An
   * unscored round says so with nulls rather than a 0 the write side refuses.
   */
  async #toRow(
    assignment: EvaluationAssignment,
    criterion: EvaluationCriterion | null,
    ownAssignments: readonly EvaluationAssignment[],
    rounds: readonly EvaluationRound[],
  ): Promise<EvaluationRowDto> {
    const [submission, score] = await Promise.all([
      this.#submissions.findById(assignment.submissionId),
      this.#ownScore(assignment, criterion),
    ])
    const round = rounds.find((candidate) => candidate.id === assignment.roundId)
    const roundsById = new Map(rounds.map((candidate) => [candidate.id, candidate]))
    const earlierAssignments = ownAssignments.filter(
      (earlier) => earlier.id !== assignment.id && earlier.submissionId === assignment.submissionId,
    )
    const earlierScores = await Promise.all(
      earlierAssignments.map((earlier) => this.#ownScore(earlier, criterion)),
    )
    const previousRounds: EvaluationPreviousRoundDto[] = earlierAssignments.flatMap(
      (earlier, index) => {
        const earlierRound = roundsById.get(earlier.roundId)
        const earlierScore = earlierScores[index]
        if (earlierRound === undefined || earlierScore === undefined) return []
        return [
          {
            roundNumber: earlierRound.number,
            roundName: earlierRound.name,
            rating: earlierScore.rating,
            comments: earlierScore.comment,
            updatedAt: earlierScore.updatedAt,
          },
        ]
      },
    )
    previousRounds.sort((left, right) => left.roundNumber - right.roundNumber)

    return {
      submissionId: assignment.submissionId,
      sessionTitle: submission?.title ?? '',
      speakerName: await this.#speakerNameFor(submission, round),
      coSpeakers: await this.#coSpeakersFor(submission, round),
      anonymized: round?.anonymize === true,
      roundId: assignment.roundId,
      roundNumber: round?.number ?? 0,
      roundName: round?.name ?? '',
      roundStatus: round?.status ?? 'closed',
      roundState: round === undefined ? 'closed' : roundStateOf(round, this.#clock.now()),
      rating: score?.rating ?? null,
      comments: score?.comment ?? null,
      updatedAt: score?.updatedAt ?? null,
      previousRounds,
    }
  }

  /** This evaluator's own score on one assignment, on the default criterion. */
  async #ownScore(
    assignment: EvaluationAssignment,
    criterion: EvaluationCriterion | null,
  ): Promise<EvaluationScore | undefined> {
    if (criterion === null) return undefined
    const scores = await this.#evaluations.listScoresByAssignment(assignment.eventId, assignment.id)
    return scores.find((candidate) => candidate.criterionId === criterion.id)
  }
}

/**
 * The comment a partial update leaves behind. An omitted `comments` key means
 * 'unchanged', so a rating-only edit keeps the justification the evaluator
 * wrote; an explicit empty string or null means 'cleared'. Blank-but-present
 * counts as cleared, because a textarea the evaluator emptied is a choice.
 */
function mergeComment(comments: string | null | undefined, stored: string | null): string | null {
  if (comments === undefined) return stored
  if (comments === null) return null
  const trimmed = comments.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Criteria with nothing recorded against them yet. */
function emptyCriteriaBreakdown(
  criteria: readonly EvaluationCriterion[],
): readonly EvaluationCriterionSummaryDto[] {
  return criteria.map((criterion) => ({
    criterionId: criterion.id,
    name: criterion.name,
    weight: criterion.weight,
    scoreCount: 0,
    ratingSum: 0,
  }))
}

/**
 * One round's result for one submission: its own assignments, the scores that
 * hang off them, and the weights that round is answerable to — the rubric it
 * recorded when it closed, or the live one while it is still open.
 */
/** One assignment's score on the default criterion, or null when unscored. */
function ownScore(
  scores: readonly EvaluationScore[],
  assignment: EvaluationAssignment,
  criterion: EvaluationCriterion | null,
): EvaluationScore | null {
  if (criterion === null) return null
  return (
    scores.find(
      (score) => score.assignmentId === assignment.id && score.criterionId === criterion.id,
    ) ?? null
  )
}

/**
 * One round summarised from its OWN typed scorecard.
 *
 * Only the ratings feed the number, because only they carry weight — a chosen
 * option and a paragraph cannot be multiplied. Both still travel to the
 * organizer on the review rows, because "not averaged" is a statement about
 * arithmetic, not about whether the committee's words are worth reading.
 */
function summarizeTypedRound(
  round: EvaluationRound,
  assignments: readonly EvaluationAssignment[],
  card: readonly RoundCriterion[],
  answers: readonly RoundScore[],
  evaluators: ReadonlyMap<ContactId, Contact | null>,
): EvaluationRoundSummaryDto {
  const byAssignment = new Map<string, RoundScore[]>()
  for (const answer of answers) {
    const bucket = byAssignment.get(answer.assignmentId) ?? []
    bucket.push(answer)
    byAssignment.set(answer.assignmentId, bucket)
  }

  const reviews: EvaluationReviewDto[] = assignments.map((assignment) => {
    const own = byAssignment.get(assignment.id) ?? []
    const ratings = new Map<string, number>()
    for (const answer of own) {
      if (answer.valueNumber !== null) ratings.set(answer.criterionId, answer.valueNumber)
    }
    const contact = evaluators.get(assignment.evaluatorContactId) ?? null
    // The words this reviewer contributed, joined so a reader sees them
    // together rather than as a shape only this screen knows how to unpack.
    const words = card
      .filter((criterion) => criterion.kind !== 'rating')
      .map((criterion) => {
        const answer = own.find((entry) => entry.criterionId === criterion.id)
        return answer?.valueText === undefined || answer.valueText === null
          ? null
          : `${criterion.label}: ${answer.valueText}`
      })
      .filter((line): line is string => line !== null)
    return {
      assignmentId: assignment.id,
      evaluatorContactId: assignment.evaluatorContactId,
      evaluatorEmail: contact?.email ?? '',
      evaluatorName: contact?.name ?? null,
      rating:
        weightedRoundAverageCentis(card, ratings) === null
          ? null
          : Math.round((weightedRoundAverageCentis(card, ratings) ?? 0) / 100),
      comment: words.length === 0 ? null : words.join('\n'),
      updatedAt: own.reduce<string | null>(
        (latest, score) => (latest === null || score.updatedAt > latest ? score.updatedAt : latest),
        null,
      ),
    }
  })

  // The round's average is the weighted average across every rating recorded
  // in it, so two reviewers scoring the same criterion both count.
  const allRatings = new Map<string, number[]>()
  for (const answer of answers) {
    if (answer.valueNumber === null) continue
    const bucket = allRatings.get(answer.criterionId) ?? []
    bucket.push(answer.valueNumber)
    allRatings.set(answer.criterionId, bucket)
  }
  const meanByCriterion = new Map<string, number>()
  for (const [criterionId, values] of allRatings) {
    meanByCriterion.set(criterionId, values.reduce((sum, value) => sum + value, 0) / values.length)
  }
  const weightedAverageCentis = weightedRoundAverageCentis(card, meanByCriterion) ?? 0
  const weightSum = card.reduce(
    (sum, criterion) =>
      criterion.kind === 'rating' && meanByCriterion.has(criterion.id)
        ? sum + (criterion.weight ?? 0)
        : sum,
    0,
  )

  return {
    roundId: round.id,
    number: round.number,
    name: round.name,
    status: round.status,
    assignmentCount: assignments.length,
    scoredCount: reviews.filter((review) => review.updatedAt !== null).length,
    scoreCount: answers.length,
    weightSum,
    weightedTotal: Math.round((weightedAverageCentis * weightSum) / 100),
    weightedAverageCentis,
    criteria: card
      .filter((criterion) => criterion.kind === 'rating')
      .map((criterion) => ({
        criterionId: criterion.id,
        name: criterion.label,
        weight: criterion.weight ?? 0,
        scoreCount: (allRatings.get(criterion.id) ?? []).length,
        ratingSum: (allRatings.get(criterion.id) ?? []).reduce((sum, value) => sum + value, 0),
      })),
    reviews,
  }
}

function summarizeRound(
  round: EvaluationRound,
  assignments: readonly EvaluationAssignment[],
  stored: readonly EvaluationScore[],
  criteria: readonly EvaluationCriterion[],
  defaultCriterion: EvaluationCriterion | null,
  evaluators: ReadonlyMap<ContactId, Contact | null>,
): EvaluationRoundSummaryDto {
  const own = new Set(assignments.map((assignment) => assignment.id))
  const scores = stored.filter((score) => own.has(score.assignmentId))
  const weights = evaluationRoundWeights(round, criteria)

  const weighted: WeightedScore[] = []
  for (const score of scores) {
    const weight = weights.get(score.criterionId)
    if (weight === undefined) continue
    weighted.push({ weight, rating: score.rating })
  }
  const totals = computeWeightedTotals(weighted)

  // Every assignment yields a review, scored or not: an organizer needs to see
  // which committee member has not answered as plainly as what the others said.
  const reviews: EvaluationReviewDto[] = assignments.map((assignment) => {
    const contact = evaluators.get(assignment.evaluatorContactId) ?? null
    const score = ownScore(scores, assignment, defaultCriterion)
    return {
      assignmentId: assignment.id,
      evaluatorContactId: assignment.evaluatorContactId,
      evaluatorEmail: contact?.email ?? '',
      evaluatorName: contact?.name ?? null,
      rating: score?.rating ?? null,
      comment: score?.comment ?? null,
      updatedAt: score?.updatedAt ?? null,
    }
  })

  return {
    roundId: round.id,
    number: round.number,
    name: round.name,
    status: round.status,
    reviews,
    assignmentCount: assignments.length,
    scoredCount: new Set(scores.map((score) => score.assignmentId)).size,
    scoreCount: totals.scoreCount,
    weightSum: totals.weightSum,
    weightedTotal: totals.weightedTotal,
    weightedAverageCentis: totals.weightedAverageCentis,
    criteria: criteria.map((criterion) => {
      const recorded = scores.filter((score) => score.criterionId === criterion.id)
      return {
        criterionId: criterion.id,
        name: criterion.name,
        weight: weights.get(criterion.id) ?? criterion.weight,
        scoreCount: recorded.length,
        ratingSum: recorded.reduce((sum, score) => sum + score.rating, 0),
      }
    }),
  }
}
