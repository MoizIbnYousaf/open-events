import type { D1Database } from '@cloudflare/workers-types'

import type {
  CommitteeRosterRow,
  EvaluationRepository,
} from '../application/ports/evaluation-repository'
import type {
  EvaluationAssignment,
  EvaluationCommitteeMember,
  EvaluationCriterion,
  EvaluationRound,
  EvaluationRoundStatus,
  EvaluationRoundWeight,
  EvaluationScore,
  RoundCriterion,
  RoundCriterionKind,
  RoundScore,
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
  readonly opens_at: string | null
  readonly closes_at: string | null
  readonly anonymize: number
}

interface RawAssignmentRow {
  readonly event_id: string
  readonly id: string
  readonly round_id: string
  readonly submission_id: string
  readonly evaluator_contact_id: string
  readonly created_at: string
  readonly recused_at: string | null
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
const ROUND_COLUMNS = `event_id, id, number, name, status, weights_json, opens_at,
                closes_at, anonymize`
const ASSIGNMENT_COLUMNS = `event_id, id, round_id, submission_id, evaluator_contact_id,
                created_at, recused_at`
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
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    // SQLite has no boolean; 1/0 is the storage and `true`/`false` is the
    // vocabulary every caller above this line speaks.
    anonymize: row.anonymize === 1,
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
    recusedAt: row.recused_at ?? null,
  }
}

interface RawRoundCriterionRow {
  readonly event_id: string
  readonly id: string
  readonly round_id: string
  readonly position: number
  readonly label: string
  readonly kind: RoundCriterionKind
  readonly weight: number | null
  readonly config_json: string | null
}

interface RawRoundScoreRow {
  readonly event_id: string
  readonly id: string
  readonly assignment_id: string
  readonly criterion_id: string
  readonly value_number: number | null
  readonly value_text: string | null
  readonly created_at: string
  readonly updated_at: string
}

const ROUND_CRITERION_COLUMNS = 'event_id, id, round_id, position, label, kind, weight, config_json'
const ROUND_SCORE_COLUMNS = `event_id, id, assignment_id, criterion_id, value_number,
                value_text, created_at, updated_at`

/**
 * The kind-specific half of a criterion. A scale and an option list have no
 * shape in common, so each kind writes only what it means and the others store
 * nothing rather than a column full of nulls.
 */
function serializeCriterionConfig(criterion: RoundCriterion): string | null {
  if (criterion.kind === 'rating' && criterion.scale !== null) {
    return JSON.stringify({ min: criterion.scale.min, max: criterion.scale.max })
  }
  if (criterion.kind === 'select' && criterion.options !== null) {
    return JSON.stringify({ options: criterion.options })
  }
  return null
}

function toRoundCriterion(row: RawRoundCriterionRow): RoundCriterion {
  const config: unknown = row.config_json === null ? null : JSON.parse(row.config_json)
  const record = (config ?? {}) as { min?: unknown; max?: unknown; options?: unknown }
  const scale =
    row.kind === 'rating' && typeof record.min === 'number' && typeof record.max === 'number'
      ? { min: record.min, max: record.max }
      : null
  const options =
    row.kind === 'select' && Array.isArray(record.options)
      ? record.options.filter((option): option is string => typeof option === 'string')
      : null
  return {
    id: row.id,
    eventId: row.event_id,
    roundId: row.round_id,
    position: row.position,
    label: row.label,
    kind: row.kind,
    weight: row.weight,
    scale,
    options,
  }
}

function toRoundScore(row: RawRoundScoreRow): RoundScore {
  return {
    id: row.id,
    eventId: row.event_id,
    assignmentId: row.assignment_id,
    criterionId: row.criterion_id,
    valueNumber: row.value_number,
    valueText: row.value_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
      // Event scope in the same statement that writes, so naming another
      // event's slug with this round's id updates nothing rather than reaching
      // across. Status is untouched here: opening and closing is its own
      // transition, guarded by the no-reopen trigger.
      const result = await db
        .prepare(
          `UPDATE evaluation_rounds
              SET name = ?, opens_at = ?, closes_at = ?, anonymize = ?
            WHERE event_id = ? AND id = ?`,
        )
        .bind(
          config.name,
          config.opensAt,
          config.closesAt,
          config.anonymize ? 1 : 0,
          eventId,
          roundId,
        )
        .run()
      if ((result.meta?.changes ?? 0) === 0) return null
      const row = await db
        .prepare(`SELECT ${ROUND_COLUMNS} FROM evaluation_rounds WHERE event_id = ? AND id = ?`)
        .bind(eventId, roundId)
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

    async listRoundCriteria(eventId: string, roundId: string): Promise<readonly RoundCriterion[]> {
      const result = await db
        .prepare(
          `SELECT ${ROUND_CRITERION_COLUMNS} FROM evaluation_round_criteria
            WHERE event_id = ? AND round_id = ? ORDER BY position`,
        )
        .bind(eventId, roundId)
        .all<RawRoundCriterionRow>()
      return result.results.map(toRoundCriterion)
    },

    async replaceRoundCriteria(
      eventId: string,
      roundId: string,
      criteria: readonly RoundCriterion[],
    ): Promise<readonly RoundCriterion[]> {
      // One batch, so a scorecard is never half-replaced: a failure part-way
      // through would otherwise leave a round holding some of the old rubric
      // and some of the new, which is a state no screen can render honestly.
      // The delete carries the event scope, so another event's round is
      // untouched even if its id were passed.
      await db.batch([
        db
          .prepare('DELETE FROM evaluation_round_criteria WHERE event_id = ? AND round_id = ?')
          .bind(eventId, roundId),
        ...criteria.map((criterion) =>
          db
            .prepare(
              `INSERT INTO evaluation_round_criteria
                 (event_id, id, round_id, position, label, kind, weight, config_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              eventId,
              criterion.id,
              roundId,
              criterion.position,
              criterion.label,
              criterion.kind,
              criterion.weight,
              serializeCriterionConfig(criterion),
            ),
        ),
      ])
      const stored = await db
        .prepare(
          `SELECT ${ROUND_CRITERION_COLUMNS} FROM evaluation_round_criteria
            WHERE event_id = ? AND round_id = ? ORDER BY position`,
        )
        .bind(eventId, roundId)
        .all<RawRoundCriterionRow>()
      return stored.results.map(toRoundCriterion)
    },

    async listRoundScoresByAssignment(
      eventId: string,
      assignmentId: string,
    ): Promise<readonly RoundScore[]> {
      const result = await db
        .prepare(
          `SELECT ${ROUND_SCORE_COLUMNS} FROM evaluation_round_scores
            WHERE event_id = ? AND assignment_id = ? ORDER BY criterion_id`,
        )
        .bind(eventId, assignmentId)
        .all<RawRoundScoreRow>()
      return result.results.map(toRoundScore)
    },

    async listRoundScoresBySubmission(
      eventId: string,
      submissionId: string,
    ): Promise<readonly RoundScore[]> {
      const result = await db
        .prepare(
          `SELECT ${ROUND_SCORE_COLUMNS.split(', ')
            .map((column) => `s.${column}`)
            .join(', ')}
             FROM evaluation_round_scores s
             JOIN evaluation_assignments a ON a.event_id = s.event_id AND a.id = s.assignment_id
            WHERE s.event_id = ? AND a.submission_id = ?
            ORDER BY s.assignment_id, s.criterion_id`,
        )
        .bind(eventId, submissionId)
        .all<RawRoundScoreRow>()
      return result.results.map(toRoundScore)
    },

    async saveRoundScore(score: RoundScore): Promise<RoundScore> {
      // Upsert on (assignment, criterion): re-scoring edits the answer that is
      // there rather than adding a second one, so reopening shows one value per
      // field. The first `created_at` survives — when they first answered is a
      // different fact from when they last changed their mind.
      await db
        .prepare(
          `INSERT INTO evaluation_round_scores
             (event_id, id, assignment_id, criterion_id, value_number, value_text,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(assignment_id, criterion_id) DO UPDATE
             SET value_number = excluded.value_number,
                 value_text   = excluded.value_text,
                 updated_at   = excluded.updated_at`,
        )
        .bind(
          score.eventId,
          score.id,
          score.assignmentId,
          score.criterionId,
          score.valueNumber,
          score.valueText,
          score.createdAt,
          score.updatedAt,
        )
        .run()
      const stored = await db
        .prepare(
          `SELECT ${ROUND_SCORE_COLUMNS} FROM evaluation_round_scores
            WHERE assignment_id = ? AND criterion_id = ?`,
        )
        .bind(score.assignmentId, score.criterionId)
        .first<RawRoundScoreRow>()
      if (stored === null) throw new Error('round score upsert stored no row')
      return toRoundScore(stored)
    },

    async recuseAssignment(
      eventId: string,
      assignmentId: string,
      recusedAt: string,
    ): Promise<void> {
      // Event scope sits in the same statement that writes, so naming another
      // event's assignment updates nothing rather than reaching across.
      // COALESCE keeps the FIRST declaration: stepping back twice is the same
      // act, and re-stamping it would rewrite when the conflict was raised.
      await db
        .prepare(
          `UPDATE evaluation_assignments
              SET recused_at = COALESCE(recused_at, ?)
            WHERE event_id = ? AND id = ?`,
        )
        .bind(recusedAt, eventId, assignmentId)
        .run()
    },

    async listRoundPool(eventId: string, roundId: string): Promise<readonly string[]> {
      const result = await db
        .prepare(
          `SELECT contact_id FROM evaluation_round_pool
            WHERE event_id = ? AND round_id = ? ORDER BY added_at, contact_id`,
        )
        .bind(eventId, roundId)
        .all<{ contact_id: string }>()
      return result.results.map((row) => row.contact_id)
    },

    async replaceRoundPool(
      eventId: string,
      roundId: string,
      contactIds: readonly string[],
      addedAt: string,
    ): Promise<void> {
      await db.batch([
        db
          .prepare('DELETE FROM evaluation_round_pool WHERE event_id = ? AND round_id = ?')
          .bind(eventId, roundId),
        ...contactIds.map((contactId) =>
          db
            .prepare(
              `INSERT INTO evaluation_round_pool (event_id, round_id, contact_id, added_at)
               VALUES (?, ?, ?, ?)`,
            )
            .bind(eventId, roundId, contactId, addedAt),
        ),
      ])
    },

    async listCommitteeRoster(eventId: string): Promise<readonly CommitteeRosterRow[]> {
      // ONE statement for the whole screen. The two counts are correlated
      // subqueries over the same event scope rather than per-member round
      // trips, and "completed" is EXISTS-a-score rather than a score join, so a
      // multi-criterion assignment counts once instead of once per criterion.
      const result = await db
        .prepare(
          `SELECT m.contact_id            AS contact_id,
                  m.added_at              AS added_at,
                  COALESCE(c.email, '')   AS email,
                  COALESCE(c.name, '')    AS name,
                  (SELECT COUNT(*) FROM evaluation_assignments a
                    WHERE a.event_id = m.event_id
                      AND a.evaluator_contact_id = m.contact_id) AS assigned_count,
                  (SELECT COUNT(*) FROM evaluation_assignments a
                    WHERE a.event_id = m.event_id
                      AND a.evaluator_contact_id = m.contact_id
                      AND (EXISTS (SELECT 1 FROM evaluation_scores s
                                    WHERE s.event_id = a.event_id
                                      AND s.assignment_id = a.id)
                           OR EXISTS (SELECT 1 FROM evaluation_round_scores rs
                                       WHERE rs.event_id = a.event_id
                                         AND rs.assignment_id = a.id))) AS completed_count
             FROM evaluation_committee_members m
             LEFT JOIN contacts c ON c.id = m.contact_id
            WHERE m.event_id = ?
            ORDER BY m.added_at, m.contact_id`,
        )
        .bind(eventId)
        .all<{
          contact_id: string
          added_at: string
          email: string
          name: string
          assigned_count: number
          completed_count: number
        }>()
      return result.results.map((row) => ({
        contactId: row.contact_id,
        email: row.email,
        name: row.name,
        addedAt: row.added_at,
        assignedCount: row.assigned_count,
        completedCount: row.completed_count,
      }))
    },

    async deleteCommitteeMember(eventId: string, contactId: string): Promise<void> {
      // Event scope lives in the same statement that deletes, so naming another
      // event's slug in the path removes nothing rather than reaching across.
      // Nothing else is touched: the contact row and every recorded score stay.
      await db
        .prepare(`DELETE FROM evaluation_committee_members WHERE event_id = ? AND contact_id = ?`)
        .bind(eventId, contactId)
        .run()
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
