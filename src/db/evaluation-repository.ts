import type { D1Database } from '@cloudflare/workers-types'

import type { EvaluationRepository } from '../application/ports/evaluation-repository'
import type {
  EvaluationAssignment,
  EvaluationCommitteeMember,
  EvaluationCriterion,
  EvaluationRound,
  EvaluationRoundStatus,
  EvaluationRoundWeight,
  EvaluationScore,
} from '../domain'
import { DbDecodeError } from './mappers'

interface RawCriterionRow {
  readonly event_id: string
  readonly id: string
  readonly name: string
  readonly weight: number
  readonly position: number
}

interface RawRoundRow {
  readonly event_id: string
  readonly id: string
  readonly number: number
  readonly name: string
  readonly status: EvaluationRoundStatus
  readonly weights_json: string | null
}

interface RawAssignmentRow {
  readonly event_id: string
  readonly id: string
  readonly round_id: string
  readonly submission_id: string
  readonly evaluator_contact_id: string
  readonly created_at: string
}

interface RawCommitteeMemberRow {
  readonly event_id: string
  readonly contact_id: string
  readonly added_at: string
}

interface RawScoreRow {
  readonly event_id: string
  readonly id: string
  readonly assignment_id: string
  readonly criterion_id: string
  readonly rating: number
  readonly comment: string | null
  readonly created_at: string
  readonly updated_at: string
}

const CRITERION_COLUMNS = 'event_id, id, name, weight, position'
const ROUND_COLUMNS = 'event_id, id, number, name, status, weights_json'
const ASSIGNMENT_COLUMNS = `event_id, id, round_id, submission_id, evaluator_contact_id,
                created_at`
const COMMITTEE_MEMBER_COLUMNS = 'event_id, contact_id, added_at'
const SCORE_COLUMNS = `event_id, id, assignment_id, criterion_id, rating, comment,
                created_at, updated_at`

function toCriterion(row: RawCriterionRow): EvaluationCriterion {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    weight: row.weight,
    position: row.position,
  }
}

/**
 * Decodes the rubric a round recorded when it closed. Anything that is not a
 * list of {criterionId, weight} is a corrupt row rather than an empty rubric,
 * so it is reported instead of being silently read as 'no weights'.
 */
function parseRoundWeights(json: string | null): readonly EvaluationRoundWeight[] | null {
  if (json === null) return null
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) {
    throw new DbDecodeError('weights_json must decode to an array')
  }
  return parsed.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new DbDecodeError('weights_json must decode to weight objects')
    }
    const record = entry as { readonly criterionId?: unknown; readonly weight?: unknown }
    if (typeof record.criterionId !== 'string' || typeof record.weight !== 'number') {
      throw new DbDecodeError('weights_json carries a malformed criterion weight')
    }
    return { criterionId: record.criterionId, weight: record.weight }
  })
}

function toRound(row: RawRoundRow): EvaluationRound {
  return {
    id: row.id,
    eventId: row.event_id,
    number: row.number,
    name: row.name,
    status: row.status,
    recordedWeights: parseRoundWeights(row.weights_json),
  }
}

function toAssignment(row: RawAssignmentRow): EvaluationAssignment {
  return {
    id: row.id,
    eventId: row.event_id,
    roundId: row.round_id,
    submissionId: row.submission_id,
    evaluatorContactId: row.evaluator_contact_id,
    createdAt: row.created_at,
  }
}

function toCommitteeMember(row: RawCommitteeMemberRow): EvaluationCommitteeMember {
  return {
    eventId: row.event_id,
    contactId: row.contact_id,
    addedAt: row.added_at,
  }
}

function toScore(row: RawScoreRow): EvaluationScore {
  return {
    id: row.id,
    eventId: row.event_id,
    assignmentId: row.assignment_id,
    criterionId: row.criterion_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * D1 adapter for the frozen `EvaluationRepository` port (migration 0010).
 *
 * Every write is expressed as a single conflict-aware statement so a repeated
 * call converges instead of raising: criteria upsert on (event_id, name),
 * rounds and assignments insert-if-absent on their unique keys, and a score
 * upserts on (assignment_id, criterion_id) keeping the first `created_at`.
 * Reads then return the stored row, so the caller always sees what persisted
 * rather than what it proposed.
 */
export function createEvaluationRepository(db: D1Database): EvaluationRepository {
  async function readCriterion(eventId: string, name: string): Promise<EvaluationCriterion | null> {
    const row = await db
      .prepare(
        `SELECT ${CRITERION_COLUMNS} FROM evaluation_criteria WHERE event_id = ? AND name = ?`,
      )
      .bind(eventId, name)
      .first<RawCriterionRow>()
    return row === null ? null : toCriterion(row)
  }

  async function readRound(eventId: string, id: string): Promise<EvaluationRound | null> {
    const row = await db
      .prepare(`SELECT ${ROUND_COLUMNS} FROM evaluation_rounds WHERE event_id = ? AND id = ?`)
      .bind(eventId, id)
      .first<RawRoundRow>()
    return row === null ? null : toRound(row)
  }

  return {
    async listCriteria(eventId: string): Promise<readonly EvaluationCriterion[]> {
      const result = await db
        .prepare(
          `SELECT ${CRITERION_COLUMNS} FROM evaluation_criteria
            WHERE event_id = ? ORDER BY position, name`,
        )
        .bind(eventId)
        .all<RawCriterionRow>()
      return result.results.map(toCriterion)
    },

    findCriterionByName: readCriterion,

    async saveCriterion(criterion: EvaluationCriterion): Promise<EvaluationCriterion> {
      await db
        .prepare(
          `INSERT INTO evaluation_criteria (event_id, id, name, weight, position)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(event_id, name) DO UPDATE
             SET weight = excluded.weight, position = excluded.position`,
        )
        .bind(criterion.eventId, criterion.id, criterion.name, criterion.weight, criterion.position)
        .run()
      const stored = await readCriterion(criterion.eventId, criterion.name)
      if (stored === null) throw new Error('criterion upsert stored no row')
      return stored
    },

    async listRounds(eventId: string): Promise<readonly EvaluationRound[]> {
      const result = await db
        .prepare(
          `SELECT ${ROUND_COLUMNS} FROM evaluation_rounds WHERE event_id = ? ORDER BY number`,
        )
        .bind(eventId)
        .all<RawRoundRow>()
      return result.results.map(toRound)
    },

    async findRoundById(id: string): Promise<EvaluationRound | null> {
      const row = await db
        .prepare(`SELECT ${ROUND_COLUMNS} FROM evaluation_rounds WHERE id = ?`)
        .bind(id)
        .first<RawRoundRow>()
      return row === null ? null : toRound(row)
    },

    async findRoundByNumber(eventId: string, number: number): Promise<EvaluationRound | null> {
      const row = await db
        .prepare(`SELECT ${ROUND_COLUMNS} FROM evaluation_rounds WHERE event_id = ? AND number = ?`)
        .bind(eventId, number)
        .first<RawRoundRow>()
      return row === null ? null : toRound(row)
    },

    async saveRound(round: EvaluationRound): Promise<EvaluationRound> {
      await db
        .prepare(
          `INSERT INTO evaluation_rounds (event_id, id, number, name, status, weights_json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          round.eventId,
          round.id,
          round.number,
          round.name,
          round.status,
          round.recordedWeights === null ? null : JSON.stringify(round.recordedWeights),
        )
        .run()
      const row = await db
        .prepare(`SELECT ${ROUND_COLUMNS} FROM evaluation_rounds WHERE event_id = ? AND number = ?`)
        .bind(round.eventId, round.number)
        .first<RawRoundRow>()
      if (row === null) throw new Error('round insert stored no row')
      return toRound(row)
    },

    /**
     * Closing is a single conditional UPDATE that also stamps the rubric the
     * round concluded under: the `status = 'open'` guard makes a repeated close
     * a no-op — so a second call can never re-stamp a published result — and
     * the event scope means a round id from another event is never closed.
     */
    async closeRound(
      eventId: string,
      id: string,
      recordedWeights: readonly EvaluationRoundWeight[],
    ): Promise<EvaluationRound | null> {
      await db
        .prepare(
          `UPDATE evaluation_rounds SET status = 'closed', weights_json = ?
            WHERE event_id = ? AND id = ? AND status = 'open'`,
        )
        .bind(JSON.stringify(recordedWeights), eventId, id)
        .run()
      return readRound(eventId, id)
    },

    async findAssignmentById(id: string): Promise<EvaluationAssignment | null> {
      const row = await db
        .prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM evaluation_assignments WHERE id = ?`)
        .bind(id)
        .first<RawAssignmentRow>()
      return row === null ? null : toAssignment(row)
    },

    async findAssignment(
      eventId: string,
      roundId: string,
      submissionId: string,
      evaluatorContactId: string,
    ): Promise<EvaluationAssignment | null> {
      const row = await db
        .prepare(
          `SELECT ${ASSIGNMENT_COLUMNS} FROM evaluation_assignments
            WHERE event_id = ? AND round_id = ? AND submission_id = ?
              AND evaluator_contact_id = ?`,
        )
        .bind(eventId, roundId, submissionId, evaluatorContactId)
        .first<RawAssignmentRow>()
      return row === null ? null : toAssignment(row)
    },

    async saveAssignment(assignment: EvaluationAssignment): Promise<EvaluationAssignment> {
      await db
        .prepare(
          `INSERT INTO evaluation_assignments
             (event_id, id, round_id, submission_id, evaluator_contact_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          assignment.eventId,
          assignment.id,
          assignment.roundId,
          assignment.submissionId,
          assignment.evaluatorContactId,
          assignment.createdAt,
        )
        .run()
      const row = await db
        .prepare(
          `SELECT ${ASSIGNMENT_COLUMNS} FROM evaluation_assignments
            WHERE event_id = ? AND round_id = ? AND submission_id = ?
              AND evaluator_contact_id = ?`,
        )
        .bind(
          assignment.eventId,
          assignment.roundId,
          assignment.submissionId,
          assignment.evaluatorContactId,
        )
        .first<RawAssignmentRow>()
      if (row === null) throw new Error('assignment insert stored no row')
      return toAssignment(row)
    },

    async findCommitteeMember(
      eventId: string,
      contactId: string,
    ): Promise<EvaluationCommitteeMember | null> {
      const row = await db
        .prepare(
          `SELECT ${COMMITTEE_MEMBER_COLUMNS} FROM evaluation_committee_members
            WHERE event_id = ? AND contact_id = ?`,
        )
        .bind(eventId, contactId)
        .first<RawCommitteeMemberRow>()
      return row === null ? null : toCommitteeMember(row)
    },

    async saveCommitteeMember(
      member: EvaluationCommitteeMember,
    ): Promise<EvaluationCommitteeMember> {
      await db
        .prepare(
          `INSERT INTO evaluation_committee_members (event_id, contact_id, added_at)
           VALUES (?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(member.eventId, member.contactId, member.addedAt)
        .run()
      const row = await db
        .prepare(
          `SELECT ${COMMITTEE_MEMBER_COLUMNS} FROM evaluation_committee_members
            WHERE event_id = ? AND contact_id = ?`,
        )
        .bind(member.eventId, member.contactId)
        .first<RawCommitteeMemberRow>()
      if (row === null) throw new Error('committee member insert stored no row')
      return toCommitteeMember(row)
    },

    async listAssignmentsBySubmission(
      eventId: string,
      submissionId: string,
    ): Promise<readonly EvaluationAssignment[]> {
      const result = await db
        .prepare(
          `SELECT ${ASSIGNMENT_COLUMNS} FROM evaluation_assignments
            WHERE event_id = ? AND submission_id = ? ORDER BY created_at, id`,
        )
        .bind(eventId, submissionId)
        .all<RawAssignmentRow>()
      return result.results.map(toAssignment)
    },

    async listAssignmentsByEvaluator(
      eventId: string,
      evaluatorContactId: string,
    ): Promise<readonly EvaluationAssignment[]> {
      const result = await db
        .prepare(
          `SELECT ${ASSIGNMENT_COLUMNS} FROM evaluation_assignments
            WHERE event_id = ? AND evaluator_contact_id = ? ORDER BY created_at, id`,
        )
        .bind(eventId, evaluatorContactId)
        .all<RawAssignmentRow>()
      return result.results.map(toAssignment)
    },

    async listScoresByAssignment(
      eventId: string,
      assignmentId: string,
    ): Promise<readonly EvaluationScore[]> {
      const result = await db
        .prepare(
          `SELECT ${SCORE_COLUMNS} FROM evaluation_scores
            WHERE event_id = ? AND assignment_id = ? ORDER BY assignment_id, criterion_id`,
        )
        .bind(eventId, assignmentId)
        .all<RawScoreRow>()
      return result.results.map(toScore)
    },

    async listScoresBySubmission(
      eventId: string,
      submissionId: string,
    ): Promise<readonly EvaluationScore[]> {
      const result = await db
        .prepare(
          `SELECT s.event_id, s.id, s.assignment_id, s.criterion_id, s.rating, s.comment,
                  s.created_at, s.updated_at
             FROM evaluation_scores s
             JOIN evaluation_assignments a
               ON a.event_id = s.event_id AND a.id = s.assignment_id
            WHERE s.event_id = ? AND a.submission_id = ?
            ORDER BY s.assignment_id, s.criterion_id`,
        )
        .bind(eventId, submissionId)
        .all<RawScoreRow>()
      return result.results.map(toScore)
    },

    async countScoresByCriterion(eventId: string, criterionId: string): Promise<number> {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM evaluation_scores
            WHERE event_id = ? AND criterion_id = ?`,
        )
        .bind(eventId, criterionId)
        .first<{ readonly n: number }>()
      return row?.n ?? 0
    },

    async upsertScore(score: EvaluationScore): Promise<EvaluationScore> {
      await db
        .prepare(
          `INSERT INTO evaluation_scores
             (event_id, id, assignment_id, criterion_id, rating, comment,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(assignment_id, criterion_id) DO UPDATE
             SET rating = excluded.rating,
                 comment = excluded.comment,
                 updated_at = excluded.updated_at`,
        )
        .bind(
          score.eventId,
          score.id,
          score.assignmentId,
          score.criterionId,
          score.rating,
          score.comment,
          score.createdAt,
          score.updatedAt,
        )
        .run()
      const row = await db
        .prepare(
          `SELECT ${SCORE_COLUMNS} FROM evaluation_scores
            WHERE assignment_id = ? AND criterion_id = ?`,
        )
        .bind(score.assignmentId, score.criterionId)
        .first<RawScoreRow>()
      if (row === null) throw new Error('score upsert stored no row')
      return toScore(row)
    },
  }
}
