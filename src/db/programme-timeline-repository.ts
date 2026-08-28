import type { D1Database, D1Result } from '@cloudflare/workers-types'

import {
  PROGRAMME_TIMELINE_LIMIT,
  type ProgrammeTimelineItemDto,
  type ProgrammeTimelineKind,
} from '../application/dtos/programme-timeline.dto'
import type { ProgrammeTimelineRepository } from '../application/ports/programme-timeline-repository'
import { DbDecodeError } from './mappers'

const SOURCE_LIMIT = PROGRAMME_TIMELINE_LIMIT + 1

interface RawSubmissionEvent {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly occurred_at: string
}

interface RawReviewEvent {
  readonly id: string
  readonly submission_id: string
  readonly submission_title: string
  readonly evaluator_name: string
  readonly round_name: string
  readonly occurred_at: string
}

interface RawDecisionEvent {
  readonly id: string
  readonly submission_id: string
  readonly submission_title: string
  readonly sequence: number
  readonly outcome: string
  readonly occurred_at: string
}

interface RawTaskEvent {
  readonly id: string
  readonly submission_id: string
  readonly submission_title: string
  readonly contact_name: string
  readonly kind: string
  readonly occurred_at: string
}

interface RawMessageEvent {
  readonly id: string
  readonly submission_id: string | null
  readonly submission_title: string | null
  readonly kind: string
  readonly subject: string
  readonly occurred_at: string
}

interface RawScheduleEvent {
  readonly submission_id: string
  readonly submission_title: string
  readonly room_label: string | null
  readonly track_label: string | null
  readonly start: string
  readonly status: string
  readonly occurred_at: string
}

const SUBMISSIONS_SQL = `
  SELECT id, title, source, submitted_at AS occurred_at
    FROM proposal_submissions
   WHERE event_id = ?
   ORDER BY submitted_at DESC, id ASC
   LIMIT ?`

const ASSIGNMENTS_SQL = `
  SELECT a.id, a.submission_id, s.title AS submission_title,
         c.name AS evaluator_name, r.name AS round_name,
         a.created_at AS occurred_at
    FROM evaluation_assignments a
    JOIN proposal_submissions s
      ON s.event_id = a.event_id AND s.id = a.submission_id
    JOIN contacts c ON c.id = a.evaluator_contact_id
    JOIN evaluation_rounds r
      ON r.event_id = a.event_id AND r.id = a.round_id
   WHERE a.event_id = ?
   ORDER BY a.created_at DESC, a.id ASC
   LIMIT ?`

const RECUSALS_SQL = `
  SELECT a.id, a.submission_id, s.title AS submission_title,
         c.name AS evaluator_name, r.name AS round_name,
         a.recused_at AS occurred_at
    FROM evaluation_assignments a
    JOIN proposal_submissions s
      ON s.event_id = a.event_id AND s.id = a.submission_id
    JOIN contacts c ON c.id = a.evaluator_contact_id
    JOIN evaluation_rounds r
      ON r.event_id = a.event_id AND r.id = a.round_id
   WHERE a.event_id = ? AND a.recused_at IS NOT NULL
   ORDER BY a.recused_at DESC, a.id ASC
   LIMIT ?`

const LEGACY_REVIEWS_SQL = `
  SELECT a.id, a.submission_id, s.title AS submission_title,
         c.name AS evaluator_name, r.name AS round_name,
         MAX(score.updated_at) AS occurred_at
    FROM evaluation_scores score
    JOIN evaluation_assignments a
      ON a.event_id = score.event_id AND a.id = score.assignment_id
    JOIN proposal_submissions s
      ON s.event_id = a.event_id AND s.id = a.submission_id
    JOIN contacts c ON c.id = a.evaluator_contact_id
    JOIN evaluation_rounds r
      ON r.event_id = a.event_id AND r.id = a.round_id
   WHERE score.event_id = ?
   GROUP BY a.id, a.submission_id, s.title, c.name, r.name
   ORDER BY occurred_at DESC, a.id ASC
   LIMIT ?`

const ROUND_REVIEWS_SQL = `
  SELECT a.id, a.submission_id, s.title AS submission_title,
         c.name AS evaluator_name, r.name AS round_name,
         MAX(score.updated_at) AS occurred_at
    FROM evaluation_round_scores score
    JOIN evaluation_assignments a
      ON a.event_id = score.event_id AND a.id = score.assignment_id
    JOIN proposal_submissions s
      ON s.event_id = a.event_id AND s.id = a.submission_id
    JOIN contacts c ON c.id = a.evaluator_contact_id
    JOIN evaluation_rounds r
      ON r.event_id = a.event_id AND r.id = a.round_id
   WHERE score.event_id = ?
   GROUP BY a.id, a.submission_id, s.title, c.name, r.name
   ORDER BY occurred_at DESC, a.id ASC
   LIMIT ?`

const DECISIONS_SQL = `
  SELECT d.id, d.submission_id, s.title AS submission_title,
         d.sequence, d.outcome, d.decided_at AS occurred_at
    FROM submission_decisions d
    JOIN proposal_submissions s
      ON s.event_id = d.event_id AND s.id = d.submission_id
   WHERE d.event_id = ?
   ORDER BY d.decided_at DESC, d.id ASC
   LIMIT ?`

const TASK_CREATED_SQL = `
  SELECT task.id, task.submission_id, s.title AS submission_title,
         c.name AS contact_name, task.kind, task.created_at AS occurred_at
    FROM speaker_tasks task
    JOIN proposal_submissions s
      ON s.event_id = task.event_id AND s.id = task.submission_id
    JOIN contacts c ON c.id = task.contact_id
   WHERE task.event_id = ?
   ORDER BY task.created_at DESC, task.id ASC
   LIMIT ?`

const TASK_COMPLETED_SQL = `
  SELECT task.id, task.submission_id, s.title AS submission_title,
         c.name AS contact_name, task.kind, task.completed_at AS occurred_at
    FROM speaker_tasks task
    JOIN proposal_submissions s
      ON s.event_id = task.event_id AND s.id = task.submission_id
    JOIN contacts c ON c.id = task.contact_id
   WHERE task.event_id = ? AND task.completed_at IS NOT NULL
   ORDER BY task.completed_at DESC, task.id ASC
   LIMIT ?`

const MESSAGES_SQL = `
  SELECT message.id,
         COALESCE(message.submission_id, confirmation.submission_id) AS submission_id,
         submission.title AS submission_title,
         message.kind, message.subject, message.created_at AS occurred_at
    FROM captured_messages message
    LEFT JOIN confirmation_records confirmation
      ON confirmation.captured_message_id = message.id
    LEFT JOIN proposal_submissions submission
      ON submission.event_id = message.event_id
     AND submission.id = COALESCE(message.submission_id, confirmation.submission_id)
   WHERE message.event_id = ?
   ORDER BY message.created_at DESC, message.id ASC
   LIMIT ?`

const SCHEDULE_SQL = `
  SELECT agenda.submission_id, submission.title AS submission_title,
         room.label AS room_label, track.label AS track_label,
         agenda.start, agenda.status, agenda.updated_at AS occurred_at
    FROM agenda_sessions agenda
    JOIN proposal_submissions submission
      ON submission.event_id = agenda.event_id AND submission.id = agenda.submission_id
    LEFT JOIN taxonomy_items room
      ON room.event_id = agenda.event_id AND room.id = agenda.room_id
    LEFT JOIN taxonomy_items track
      ON track.event_id = agenda.event_id AND track.id = agenda.track_id
   WHERE agenda.event_id = ? AND agenda.assignment = 'scheduled'
   ORDER BY agenda.updated_at DESC, agenda.submission_id ASC
   LIMIT ?`

function personLabel(name: string, fallback: 'Reviewer' | 'Speaker'): string {
  const normalized = name.trim()
  return normalized === '' || normalized.includes('@') ? fallback : normalized
}

function reviewDetail(row: RawReviewEvent): string {
  return `${personLabel(row.evaluator_name, 'Reviewer')} · ${row.round_name} · ${row.submission_title}`
}

function reviewItem(
  row: RawReviewEvent,
  kind: Extract<ProgrammeTimelineKind, 'review_assigned' | 'review_recused' | 'review_saved'>,
): ProgrammeTimelineItemDto {
  const title =
    kind === 'review_assigned'
      ? 'Review assigned'
      : kind === 'review_recused'
        ? 'Reviewer recused'
        : 'Latest review saved'
  return {
    id: `${kind}:${row.id}`,
    kind,
    category: 'reviews',
    occurredAt: row.occurred_at,
    title,
    detail: reviewDetail(row),
    submissionId: row.submission_id,
    submissionTitle: row.submission_title,
  }
}

function taskLabel(kind: string): string {
  if (kind === 'confirm_participation') return 'Confirm participation'
  if (kind === 'submit_bio') return 'Submit bio'
  if (kind === 'submit_headshot') return 'Submit headshot'
  if (kind === 'complete_form') return 'Complete assigned form'
  throw new DbDecodeError(`programme timeline task carries unknown kind '${kind}'`)
}

function messageKind(
  kind: string,
): Extract<
  ProgrammeTimelineKind,
  'confirmation_recorded' | 'acceptance_recorded' | 'reminder_recorded'
> {
  if (kind === 'confirmation') return 'confirmation_recorded'
  if (kind === 'acceptance') return 'acceptance_recorded'
  if (kind === 'reminder') return 'reminder_recorded'
  throw new DbDecodeError(`programme timeline message carries unknown kind '${kind}'`)
}

function messageTitle(kind: ReturnType<typeof messageKind>): string {
  if (kind === 'confirmation_recorded') return 'Confirmation recorded'
  if (kind === 'acceptance_recorded') return 'Acceptance message recorded'
  return 'Reminder recorded'
}

function sourceRows<T>(result: D1Result<unknown>): readonly T[] {
  return result.results as unknown as readonly T[]
}

function scheduleDetail(row: RawScheduleEvent): string {
  const start = `${row.start.slice(0, 16).replace('T', ' ')} UTC`
  return [
    row.submission_title,
    row.room_label ?? 'Room not set',
    row.track_label,
    start,
    row.status === 'published' ? 'Published' : 'Draft',
  ]
    .filter((value): value is string => value !== null)
    .join(' · ')
}

/**
 * Reads each typed lifecycle source independently in one fixed D1 batch, then
 * projects those facts into a common read model. No mutable activity log is
 * written and no query grows with the number of submissions.
 */
export function createProgrammeTimelineRepository(db: D1Database): ProgrammeTimelineRepository {
  return {
    async listLatest(eventId) {
      const results = await db.batch([
        db.prepare(SUBMISSIONS_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(ASSIGNMENTS_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(RECUSALS_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(LEGACY_REVIEWS_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(ROUND_REVIEWS_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(DECISIONS_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(TASK_CREATED_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(TASK_COMPLETED_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(MESSAGES_SQL).bind(eventId, SOURCE_LIMIT),
        db.prepare(SCHEDULE_SQL).bind(eventId, SOURCE_LIMIT),
      ])
      if (results.length !== 10 || results.some((result) => result === undefined)) {
        throw new DbDecodeError('programme timeline batch returned an incomplete result set')
      }
      const [
        submissionResult,
        assignmentResult,
        recusalResult,
        legacyReviewResult,
        roundReviewResult,
        decisionResult,
        taskCreatedResult,
        taskCompletedResult,
        messageResult,
        scheduleResult,
      ] = results as [
        D1Result<unknown>,
        D1Result<unknown>,
        D1Result<unknown>,
        D1Result<unknown>,
        D1Result<unknown>,
        D1Result<unknown>,
        D1Result<unknown>,
        D1Result<unknown>,
        D1Result<unknown>,
        D1Result<unknown>,
      ]
      const sources = [
        sourceRows<RawSubmissionEvent>(submissionResult),
        sourceRows<RawReviewEvent>(assignmentResult),
        sourceRows<RawReviewEvent>(recusalResult),
        sourceRows<RawReviewEvent>(legacyReviewResult),
        sourceRows<RawReviewEvent>(roundReviewResult),
        sourceRows<RawDecisionEvent>(decisionResult),
        sourceRows<RawTaskEvent>(taskCreatedResult),
        sourceRows<RawTaskEvent>(taskCompletedResult),
        sourceRows<RawMessageEvent>(messageResult),
        sourceRows<RawScheduleEvent>(scheduleResult),
      ] as const
      const items: ProgrammeTimelineItemDto[] = []

      for (const row of sources[0]) {
        if (row.source !== 'cfp' && row.source !== 'direct') {
          throw new DbDecodeError(
            `programme timeline submission carries unknown source '${row.source}'`,
          )
        }
        const direct = row.source === 'direct'
        items.push({
          id: `${direct ? 'direct_session_created' : 'proposal_submitted'}:${row.id}`,
          kind: direct ? 'direct_session_created' : 'proposal_submitted',
          category: 'submissions',
          occurredAt: row.occurred_at,
          title: direct ? 'Direct session created' : 'Proposal submitted',
          detail: row.title,
          submissionId: row.id,
          submissionTitle: row.title,
        })
      }
      items.push(...sources[1].map((row) => reviewItem(row, 'review_assigned')))
      items.push(...sources[2].map((row) => reviewItem(row, 'review_recused')))
      items.push(...sources[3].map((row) => reviewItem(row, 'review_saved')))
      items.push(...sources[4].map((row) => reviewItem(row, 'review_saved')))

      for (const row of sources[5]) {
        if (row.outcome !== 'accepted' && row.outcome !== 'rejected') {
          throw new DbDecodeError(
            `programme timeline decision carries unknown outcome '${row.outcome}'`,
          )
        }
        const accepted = row.outcome === 'accepted'
        items.push({
          id: `decision:${row.id}`,
          kind: accepted ? 'decision_accepted' : 'decision_rejected',
          category: 'decisions',
          occurredAt: row.occurred_at,
          title: accepted ? 'Proposal accepted' : 'Proposal rejected',
          detail: `${row.submission_title} · decision ${row.sequence}`,
          submissionId: row.submission_id,
          submissionTitle: row.submission_title,
        })
      }

      for (const [rows, completed] of [
        [sources[6], false],
        [sources[7], true],
      ] as const) {
        for (const row of rows) {
          items.push({
            id: `${completed ? 'speaker_task_completed' : 'speaker_task_assigned'}:${row.id}`,
            kind: completed ? 'speaker_task_completed' : 'speaker_task_assigned',
            category: 'onboarding',
            occurredAt: row.occurred_at,
            title: completed ? 'Speaker task completed' : 'Speaker task assigned',
            detail: `${taskLabel(row.kind)} · ${personLabel(row.contact_name, 'Speaker')} · ${row.submission_title}`,
            submissionId: row.submission_id,
            submissionTitle: row.submission_title,
          })
        }
      }

      for (const row of sources[8]) {
        const kind = messageKind(row.kind)
        items.push({
          id: `${kind}:${row.id}`,
          kind,
          category: 'communications',
          occurredAt: row.occurred_at,
          title: messageTitle(kind),
          detail:
            row.submission_title === null
              ? row.subject
              : `${row.submission_title} · ${row.subject}`,
          submissionId: row.submission_id,
          submissionTitle: row.submission_title,
        })
      }

      for (const row of sources[9]) {
        items.push({
          id: `schedule_current:${row.submission_id}`,
          kind: 'schedule_current',
          category: 'schedule',
          occurredAt: row.occurred_at,
          title: 'Current schedule placement',
          detail: scheduleDetail(row),
          submissionId: row.submission_id,
          submissionTitle: row.submission_title,
        })
      }

      return {
        items,
        truncatedCategories: [
          ...(sources[0].length > PROGRAMME_TIMELINE_LIMIT ? (['submissions'] as const) : []),
          ...(sources.slice(1, 5).some((rows) => rows.length > PROGRAMME_TIMELINE_LIMIT)
            ? (['reviews'] as const)
            : []),
          ...(sources[5].length > PROGRAMME_TIMELINE_LIMIT ? (['decisions'] as const) : []),
          ...(sources.slice(6, 8).some((rows) => rows.length > PROGRAMME_TIMELINE_LIMIT)
            ? (['onboarding'] as const)
            : []),
          ...(sources[8].length > PROGRAMME_TIMELINE_LIMIT ? (['communications'] as const) : []),
          ...(sources[9].length > PROGRAMME_TIMELINE_LIMIT ? (['schedule'] as const) : []),
        ],
      }
    },
  }
}
