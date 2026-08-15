import type { CommitteeRosterRow, EvaluationRepository } from '../../../src/application'
import type {
  EvaluationAssignment,
  EvaluationCommitteeMember,
  EvaluationCriterion,
  EvaluationRound,
  EvaluationRoundWeight,
  EvaluationScore,
  RoundCriterion,
  RoundScore,
} from '../../../src/domain'
import { closeEvaluationRound } from '../../../src/domain'

/**
 * Composite-key separator: a NUL, which no identifier can contain. It is
 * written as an escape and never as a raw byte — a raw NUL makes git classify
 * this TypeScript source as binary, and the file then has no reviewable diff.
 */
const KEY_SEPARATOR = '\u0000'

function scoreKey(assignmentId: string, criterionId: string): string {
  return `${assignmentId}${KEY_SEPARATOR}${criterionId}`
}

function assignmentKey(roundId: string, submissionId: string, evaluatorContactId: string): string {
  return `${roundId}${KEY_SEPARATOR}${submissionId}${KEY_SEPARATOR}${evaluatorContactId}`
}

/**
 * Code-unit comparison, which is what SQLite's default BINARY collation does.
 * `localeCompare` is ICU-aware and disagrees — it sorts 'audience' before
 * 'Zeal' and ignores punctuation such as the dashes in a UUID — so the double
 * would order rows the SQL adapter never would.
 */
function compareBinary(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

/**
 * In-memory twin of the D1 evaluation adapter. Every read is event-scoped and
 * ordered exactly like the SQL adapter — criteria by (position, name), rounds
 * by number, assignments by (createdAt, id), scores by (assignmentId,
 * criterionId), all text compared by code unit — so the service contract is
 * adapter-independent.
 */
export class InMemoryEvaluationRepository implements EvaluationRepository {
  readonly #criteria = new Map<string, EvaluationCriterion>()
  readonly #rounds = new Map<string, EvaluationRound>()
  readonly #assignments = new Map<string, EvaluationAssignment>()
  readonly #scores = new Map<string, EvaluationScore>()
  readonly #committee = new Map<string, EvaluationCommitteeMember>()
  readonly #roundCriteria = new Map<string, RoundCriterion>()
  readonly #roundScores = new Map<string, RoundScore>()
  readonly #roundPool = new Map<string, { contactId: string; addedAt: string }[]>()

  constructor(
    criteria: readonly EvaluationCriterion[] = [],
    rounds: readonly EvaluationRound[] = [],
    assignments: readonly EvaluationAssignment[] = [],
    scores: readonly EvaluationScore[] = [],
  ) {
    for (const criterion of criteria) this.#criteria.set(criterion.id, criterion)
    for (const round of rounds) this.#rounds.set(round.id, round)
    for (const assignment of assignments) this.#assignments.set(assignment.id, assignment)
    for (const score of scores)
      this.#scores.set(scoreKey(score.assignmentId, score.criterionId), score)
  }

  async listCriteria(eventId: string): Promise<readonly EvaluationCriterion[]> {
    return [...this.#criteria.values()]
      .filter((criterion) => criterion.eventId === eventId)
      .sort((left, right) => left.position - right.position || compareBinary(left.name, right.name))
  }

  async findCriterionByName(eventId: string, name: string): Promise<EvaluationCriterion | null> {
    for (const criterion of this.#criteria.values()) {
      if (criterion.eventId === eventId && criterion.name === name) return criterion
    }
    return null
  }

  async saveCriterion(criterion: EvaluationCriterion): Promise<EvaluationCriterion> {
    this.#criteria.set(criterion.id, criterion)
    return criterion
  }

  async listRounds(eventId: string): Promise<readonly EvaluationRound[]> {
    return [...this.#rounds.values()]
      .filter((round) => round.eventId === eventId)
      .sort((left, right) => left.number - right.number)
  }

  async findRoundById(id: string): Promise<EvaluationRound | null> {
    return this.#rounds.get(id) ?? null
  }

  async findRoundByNumber(eventId: string, number: number): Promise<EvaluationRound | null> {
    for (const round of this.#rounds.values()) {
      if (round.eventId === eventId && round.number === number) return round
    }
    return null
  }

  async saveRound(round: EvaluationRound): Promise<EvaluationRound> {
    this.#rounds.set(round.id, round)
    return round
  }

  async configureRound(
    eventId: string,
    roundId: string,
    config: {
      readonly name: string
      readonly opensAt: string | null
      readonly closesAt: string | null
      readonly anonymize: boolean
    },
  ): Promise<EvaluationRound | null> {
    const round = this.#rounds.get(roundId)
    // Event scope, mirroring the adapter's WHERE: a round of another event is
    // simply not found here either.
    if (round === undefined || round.eventId !== eventId) return null
    const configured: EvaluationRound = { ...round, ...config }
    this.#rounds.set(roundId, configured)
    return configured
  }

  async listRoundCriteria(eventId: string, roundId: string): Promise<readonly RoundCriterion[]> {
    return [...this.#roundCriteria.values()]
      .filter((criterion) => criterion.eventId === eventId && criterion.roundId === roundId)
      .sort((left, right) => left.position - right.position)
  }

  async replaceRoundCriteria(
    eventId: string,
    roundId: string,
    criteria: readonly RoundCriterion[],
  ): Promise<readonly RoundCriterion[]> {
    const incoming = new Set(criteria.map((criterion) => criterion.id))
    for (const [id, criterion] of [...this.#roundCriteria.entries()]) {
      if (criterion.eventId !== eventId || criterion.roundId !== roundId) continue
      if (incoming.has(id)) continue
      this.#roundCriteria.delete(id)
      // Only answers to a removed question go with it.
      for (const [key, score] of [...this.#roundScores.entries()]) {
        if (score.criterionId === id) this.#roundScores.delete(key)
      }
    }
    for (const criterion of criteria) this.#roundCriteria.set(criterion.id, criterion)
    return this.listRoundCriteria(eventId, roundId)
  }

  async listRoundScoresByAssignment(
    eventId: string,
    assignmentId: string,
  ): Promise<readonly RoundScore[]> {
    return [...this.#roundScores.values()]
      .filter((score) => score.eventId === eventId && score.assignmentId === assignmentId)
      .sort((left, right) => compareBinary(left.criterionId, right.criterionId))
  }

  async listRoundScoresBySubmission(
    eventId: string,
    submissionId: string,
  ): Promise<readonly RoundScore[]> {
    const assignmentIds = new Set(
      [...this.#assignments.values()]
        .filter(
          (assignment) =>
            assignment.eventId === eventId && assignment.submissionId === submissionId,
        )
        .map((assignment) => assignment.id),
    )
    return [...this.#roundScores.values()]
      .filter((score) => score.eventId === eventId && assignmentIds.has(score.assignmentId))
      .sort(
        (left, right) =>
          compareBinary(left.assignmentId, right.assignmentId) ||
          compareBinary(left.criterionId, right.criterionId),
      )
  }

  async saveRoundScore(score: RoundScore): Promise<RoundScore> {
    const key = scoreKey(score.assignmentId, score.criterionId)
    const existing = this.#roundScores.get(key)
    // The first `createdAt` survives, as the adapter's upsert does: when they
    // first answered is a different fact from when they last changed it.
    const stored: RoundScore = { ...score, createdAt: existing?.createdAt ?? score.createdAt }
    this.#roundScores.set(key, stored)
    return stored
  }

  async listRoundPool(eventId: string, roundId: string): Promise<readonly string[]> {
    // Ordered by (addedAt, contactId) exactly as the adapter's ORDER BY does,
    // so the double cannot present a sequence production never would.
    return (this.#roundPool.get(`${eventId}${KEY_SEPARATOR}${roundId}`) ?? [])
      .slice()
      .sort(
        (left, right) =>
          compareBinary(left.addedAt, right.addedAt) ||
          compareBinary(left.contactId, right.contactId),
      )
      .map((entry) => entry.contactId)
  }

  async replaceRoundPool(
    eventId: string,
    roundId: string,
    contactIds: readonly string[],
    addedAt: string,
  ): Promise<void> {
    this.#roundPool.set(
      `${eventId}${KEY_SEPARATOR}${roundId}`,
      contactIds.map((contactId) => ({ contactId, addedAt })),
    )
  }

  async closeRound(
    eventId: string,
    id: string,
    recordedWeights: readonly EvaluationRoundWeight[],
  ): Promise<EvaluationRound | null> {
    const round = this.#rounds.get(id)
    if (round === undefined || round.eventId !== eventId) return null
    const closed = closeEvaluationRound(round, recordedWeights)
    this.#rounds.set(id, closed)
    return closed
  }

  async findAssignmentById(id: string): Promise<EvaluationAssignment | null> {
    return this.#assignments.get(id) ?? null
  }

  async findAssignment(
    eventId: string,
    roundId: string,
    submissionId: string,
    evaluatorContactId: string,
  ): Promise<EvaluationAssignment | null> {
    const wanted = assignmentKey(roundId, submissionId, evaluatorContactId)
    for (const assignment of this.#assignments.values()) {
      if (assignment.eventId !== eventId) continue
      const key = assignmentKey(
        assignment.roundId,
        assignment.submissionId,
        assignment.evaluatorContactId,
      )
      if (key === wanted) return assignment
    }
    return null
  }

  async findCommitteeMember(
    eventId: string,
    contactId: string,
  ): Promise<EvaluationCommitteeMember | null> {
    return this.#committee.get(`${eventId}${KEY_SEPARATOR}${contactId}`) ?? null
  }

  async saveCommitteeMember(member: EvaluationCommitteeMember): Promise<EvaluationCommitteeMember> {
    const key = `${member.eventId}${KEY_SEPARATOR}${member.contactId}`
    const existing = this.#committee.get(key)
    if (existing !== undefined) return existing
    this.#committee.set(key, member)
    return member
  }

  /**
   * Mirrors the single-statement projection the D1 repository does, counts
   * included, so a service that trusts one shape gets the same answers from
   * both. `email`/`name` are blank here because this double holds no contacts;
   * tests that care about identity assert through the real repository.
   */
  async listCommitteeRoster(eventId: string): Promise<readonly CommitteeRosterRow[]> {
    return [...this.#committee.values()]
      .filter((member) => member.eventId === eventId)
      .sort((left, right) => left.addedAt.localeCompare(right.addedAt))
      .map((member) => {
        const assignments = [...this.#assignments.values()].filter(
          (assignment) =>
            assignment.eventId === eventId && assignment.evaluatorContactId === member.contactId,
        )
        const scored = assignments.filter((assignment) =>
          [...this.#scores.values()].some(
            (score) => score.eventId === eventId && score.assignmentId === assignment.id,
          ),
        )
        return {
          contactId: member.contactId,
          email: '',
          name: '',
          addedAt: member.addedAt,
          assignedCount: assignments.length,
          completedCount: scored.length,
        }
      })
  }

  async deleteCommitteeMember(eventId: string, contactId: string): Promise<void> {
    // The seat only. Assignments and scores are keyed elsewhere and stay put,
    // mirroring the D1 delete's deliberately narrow reach.
    this.#committee.delete(`${eventId}${KEY_SEPARATOR}${contactId}`)
    // …except the round pools, which the schema cascades: a pool is a
    // narrowing of a seat, so losing the seat cannot leave them pooled.
    for (const [key, pooled] of [...this.#roundPool.entries()]) {
      if (key.startsWith(`${eventId}${KEY_SEPARATOR}`)) {
        this.#roundPool.set(
          key,
          pooled.filter((entry) => entry.contactId !== contactId),
        )
      }
    }
  }

  async saveAssignment(assignment: EvaluationAssignment): Promise<EvaluationAssignment> {
    this.#assignments.set(assignment.id, assignment)
    return assignment
  }

  async recuseAssignment(eventId: string, assignmentId: string, recusedAt: string): Promise<void> {
    const held = this.#assignments.get(assignmentId)
    if (held === undefined || held.eventId !== eventId) return
    // First declaration stands, exactly as the SQL COALESCE does.
    this.#assignments.set(assignmentId, {
      ...held,
      recusedAt: held.recusedAt ?? recusedAt,
    })
  }

  async listAssignmentsBySubmission(
    eventId: string,
    submissionId: string,
  ): Promise<readonly EvaluationAssignment[]> {
    return this.#sortedAssignments(
      (assignment) => assignment.eventId === eventId && assignment.submissionId === submissionId,
    )
  }

  async listAssignmentsByEvaluator(
    eventId: string,
    evaluatorContactId: string,
  ): Promise<readonly EvaluationAssignment[]> {
    return this.#sortedAssignments(
      (assignment) =>
        assignment.eventId === eventId && assignment.evaluatorContactId === evaluatorContactId,
    )
  }

  async listScoresByAssignment(
    eventId: string,
    assignmentId: string,
  ): Promise<readonly EvaluationScore[]> {
    return this.#sortedScores(
      (score) => score.eventId === eventId && score.assignmentId === assignmentId,
    )
  }

  async listScoresBySubmission(
    eventId: string,
    submissionId: string,
  ): Promise<readonly EvaluationScore[]> {
    const assignmentIds = new Set(
      (await this.listAssignmentsBySubmission(eventId, submissionId)).map(
        (assignment) => assignment.id,
      ),
    )
    return this.#sortedScores(
      (score) => score.eventId === eventId && assignmentIds.has(score.assignmentId),
    )
  }

  async countScoresByCriterion(eventId: string, criterionId: string): Promise<number> {
    return this.#sortedScores(
      (score) => score.eventId === eventId && score.criterionId === criterionId,
    ).length
  }

  async upsertScore(score: EvaluationScore): Promise<EvaluationScore> {
    const key = scoreKey(score.assignmentId, score.criterionId)
    const existing = this.#scores.get(key)
    const stored: EvaluationScore =
      existing === undefined ? score : { ...score, id: existing.id, createdAt: existing.createdAt }
    this.#scores.set(key, stored)
    return stored
  }

  #sortedAssignments(
    predicate: (assignment: EvaluationAssignment) => boolean,
  ): readonly EvaluationAssignment[] {
    return [...this.#assignments.values()]
      .filter(predicate)
      .sort(
        (left, right) =>
          compareBinary(left.createdAt, right.createdAt) || compareBinary(left.id, right.id),
      )
  }

  #sortedScores(predicate: (score: EvaluationScore) => boolean): readonly EvaluationScore[] {
    return [...this.#scores.values()]
      .filter(predicate)
      .sort(
        (left, right) =>
          compareBinary(left.assignmentId, right.assignmentId) ||
          compareBinary(left.criterionId, right.criterionId),
      )
  }
}
