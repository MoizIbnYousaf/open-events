import type { D1Database } from '@cloudflare/workers-types'

import type {
  SubmissionDeskChoiceField,
  SubmissionDeskRecord,
} from '../application/dtos/submission-desk.dto'
import { SUBMISSION_DESK_SCAN_LIMIT } from '../application/dtos/submission-desk.dto'
import type { SubmissionDeskRepository } from '../application/ports/submission-desk-repository'
import { isSubmissionDecisionOutcome, type SubmissionOutcome } from '../domain'
import {
  DbDecodeError,
  type RawProposalSubmissionRow,
  toProposalSubmissionFromRaw,
} from './mappers'

interface RawDeskRow extends RawProposalSubmissionRow {
  readonly form_id: string
  readonly form_slug: string
  readonly form_version: number
  readonly primary_contact_id: string
  readonly primary_name: string
  readonly primary_email: string
  readonly co_speaker_count: number
  readonly decision: string
}

interface RawChoiceFieldRow {
  readonly element_id: string
  readonly version_id: string
  readonly form_id: string
  readonly form_slug: string
  readonly version: number
  readonly field_key: string
  readonly label: string
  readonly question_type: string
  readonly position: number
  readonly options_json: string | null
}

interface RawCountRow {
  readonly total: number
}

function decision(value: string): SubmissionOutcome {
  if (value === 'pending' || isSubmissionDecisionOutcome(value)) return value
  throw new DbDecodeError(`submission desk row carries unknown decision '${value}'`)
}

function options(json: string | null): readonly string[] {
  if (json === null) return []
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
    throw new DbDecodeError('submission desk options_json must decode to a string array')
  }
  return parsed
}

function choiceField(row: RawChoiceFieldRow): SubmissionDeskChoiceField {
  if (row.question_type !== 'single_choice' && row.question_type !== 'multi_choice') {
    throw new DbDecodeError(
      `submission desk field carries unknown choice type '${row.question_type}'`,
    )
  }
  return {
    elementId: row.element_id,
    versionId: row.version_id,
    formId: row.form_id,
    formSlug: row.form_slug,
    version: row.version,
    fieldKey: row.field_key,
    label: row.label,
    questionType: row.question_type,
    position: row.position,
    options: options(row.options_json),
  }
}

function deskRecord(row: RawDeskRow): SubmissionDeskRecord {
  const submission = toProposalSubmissionFromRaw(row)
  return {
    formVersionId: submission.formVersionId,
    answers: submission.answers,
    item: {
      id: submission.id,
      title: submission.title,
      status: submission.status,
      source: submission.source,
      formId: row.form_id,
      formSlug: row.form_slug,
      version: row.form_version,
      routing: submission.routing,
      primarySpeaker: {
        contactId: row.primary_contact_id,
        name: row.primary_name,
        email: row.primary_email,
        role: 'primary',
        position: 0,
      },
      coSpeakerCount: row.co_speaker_count,
      decision: decision(row.decision),
      createdAt: submission.createdAt,
      submittedAt: submission.submittedAt,
    },
  }
}

const ROWS_SQL = `
  WITH co_speakers AS (
    SELECT event_id, submission_id, COUNT(*) AS co_speaker_count
      FROM submission_contributors
     WHERE event_id = ? AND role = 'co-speaker'
     GROUP BY event_id, submission_id
  ), latest_decisions AS (
    SELECT event_id, submission_id, outcome
      FROM (
        SELECT event_id, submission_id, outcome,
               ROW_NUMBER() OVER (
                 PARTITION BY event_id, submission_id ORDER BY sequence DESC
               ) AS decision_rank
          FROM submission_decisions
         WHERE event_id = ?
      )
     WHERE decision_rank = 1
  )
  SELECT s.id, s.event_id, s.owner_contact_id, s.form_version_id, s.origin_draft_id,
         s.status, s.source, s.title, s.answers_json, s.content_hash, s.routing_json,
         s.created_at, s.submitted_at,
         v.form_id, v.version AS form_version, f.slug AS form_slug,
         primary_contributor.contact_id AS primary_contact_id,
         primary_contact.name AS primary_name,
         primary_contact.email AS primary_email,
         COALESCE(co_speakers.co_speaker_count, 0) AS co_speaker_count,
         COALESCE(latest_decisions.outcome, 'pending') AS decision
    FROM proposal_submissions s
    JOIN cfp_form_versions v
      ON v.event_id = s.event_id AND v.id = s.form_version_id
    JOIN cfp_forms f
      ON f.event_id = v.event_id AND f.id = v.form_id
    JOIN submission_contributors primary_contributor
      ON primary_contributor.event_id = s.event_id
     AND primary_contributor.submission_id = s.id
     AND primary_contributor.role = 'primary'
     AND primary_contributor.position = 0
    JOIN contacts primary_contact ON primary_contact.id = primary_contributor.contact_id
    LEFT JOIN co_speakers
      ON co_speakers.event_id = s.event_id AND co_speakers.submission_id = s.id
    LEFT JOIN latest_decisions
      ON latest_decisions.event_id = s.event_id AND latest_decisions.submission_id = s.id
   WHERE s.event_id = ? AND s.source = 'cfp'
   ORDER BY s.submitted_at DESC, s.id ASC
   LIMIT ?`

const FIELDS_SQL = `
  SELECT e.id AS element_id, e.version_id, v.form_id, f.slug AS form_slug,
         v.version, e.field_key, e.label, e.question_type, e.position, e.options_json
    FROM cfp_elements e
    JOIN cfp_form_versions v ON v.event_id = e.event_id AND v.id = e.version_id
    JOIN cfp_forms f ON f.event_id = v.event_id AND f.id = v.form_id
   WHERE e.event_id = ?
     AND e.field_key IS NOT NULL
     AND e.label IS NOT NULL
     AND e.question_type IN ('single_choice', 'multi_choice')
   ORDER BY f.slug ASC, v.version ASC, e.position ASC, e.id ASC`

const COUNT_SQL = `
  SELECT COUNT(*) AS total
    FROM proposal_submissions
   WHERE event_id = ? AND source = 'cfp'`

/**
 * Builds the complete organizer list in a fixed three-statement D1 batch.
 * The row scan is hard-capped at the measured 1,000-submission budget; the
 * separate count keeps any truncation visible instead of pretending it did not
 * happen.
 */
export function createSubmissionDeskRepository(db: D1Database): SubmissionDeskRepository {
  return {
    async listByEvent(eventId) {
      const [rowResult, fieldResult, countResult] = await db.batch([
        db.prepare(ROWS_SQL).bind(eventId, eventId, eventId, SUBMISSION_DESK_SCAN_LIMIT + 1),
        db.prepare(FIELDS_SQL).bind(eventId),
        db.prepare(COUNT_SQL).bind(eventId),
      ])
      if (rowResult === undefined || fieldResult === undefined || countResult === undefined) {
        throw new DbDecodeError('submission desk batch returned an incomplete result set')
      }
      const rawRows = rowResult.results as unknown as RawDeskRow[]
      const rawFields = fieldResult.results as unknown as RawChoiceFieldRow[]
      const count = (countResult.results as unknown as RawCountRow[])[0]?.total ?? 0
      const expectedRows = Math.min(count, SUBMISSION_DESK_SCAN_LIMIT + 1)
      if (rawRows.length !== expectedRows) {
        throw new DbDecodeError(
          'submission desk could not hydrate every submission in its bounded scan',
        )
      }
      return {
        records: rawRows.slice(0, SUBMISSION_DESK_SCAN_LIMIT).map(deskRecord),
        choiceFields: rawFields.map(choiceField),
        total: count,
        truncated: rawRows.length > SUBMISSION_DESK_SCAN_LIMIT,
      }
    },
  }
}
