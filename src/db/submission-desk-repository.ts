import type { D1Database } from '@cloudflare/workers-types'

import type {
  SubmissionDeskChoiceField,
  SubmissionDeskFacetCount,
  SubmissionDeskQuery,
  SubmissionDeskRecord,
  SubmissionFacetOptionDto,
} from '../application/dtos/submission-desk.dto'
import { SUBMISSION_DESK_PAGE_SIZE } from '../application/dtos/submission-desk.dto'
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
  readonly snapshot_matching_total: number
  readonly resolved_page: number
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

interface RawFacetCountRow {
  readonly element_id: string
  readonly value: string
  readonly count: number
}

interface RawRoutingCountRow {
  readonly value: string
  readonly count: number
}

interface RawCountRow {
  readonly total: number
}

interface SqlFilter {
  readonly where: string
  readonly binds: readonly unknown[]
  readonly orderBy: string
}

const LATEST_DECISION_SQL = `COALESCE((
  SELECT candidate.outcome
    FROM submission_decisions candidate
   WHERE candidate.event_id = s.event_id
     AND candidate.submission_id = s.id
   ORDER BY candidate.sequence DESC
   LIMIT 1
), 'pending')`

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

/** Reverse edges that JavaScript lowercase exposes but uppercase alone loses. */
const REVERSE_SIMPLE_CASE_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  ǆ: ['ǅ'],
  ǉ: ['ǈ'],
  ǌ: ['ǋ'],
  ǳ: ['ǲ'],
  θ: ['ϴ'],
  ß: ['ẞ'],
  ᾀ: ['ᾈ'],
  ᾁ: ['ᾉ'],
  ᾂ: ['ᾊ'],
  ᾃ: ['ᾋ'],
  ᾄ: ['ᾌ'],
  ᾅ: ['ᾍ'],
  ᾆ: ['ᾎ'],
  ᾇ: ['ᾏ'],
  ᾐ: ['ᾘ'],
  ᾑ: ['ᾙ'],
  ᾒ: ['ᾚ'],
  ᾓ: ['ᾛ'],
  ᾔ: ['ᾜ'],
  ᾕ: ['ᾝ'],
  ᾖ: ['ᾞ'],
  ᾗ: ['ᾟ'],
  ᾠ: ['ᾨ'],
  ᾡ: ['ᾩ'],
  ᾢ: ['ᾪ'],
  ᾣ: ['ᾫ'],
  ᾤ: ['ᾬ'],
  ᾥ: ['ᾭ'],
  ᾦ: ['ᾮ'],
  ᾧ: ['ᾯ'],
  ᾳ: ['ᾼ'],
  ῃ: ['ῌ'],
  ῳ: ['ῼ'],
  ω: ['Ω'],
  k: ['K'],
  å: ['Å'],
}

function requiresUnicodeCaseSearch(value: string): boolean {
  return [...value].some(
    (character) =>
      (character.codePointAt(0) ?? 0) > 0x7f ||
      REVERSE_SIMPLE_CASE_VARIANTS[character.toLocaleLowerCase('en-US')] !== undefined,
  )
}

function unicodeCaseMatrix(value: string): string {
  return JSON.stringify(
    [...value].map((character) => {
      const variants = new Set([character])
      for (let pass = 0; pass < 2; pass += 1) {
        for (const candidate of [...variants]) {
          for (const transformed of [
            candidate.toLocaleLowerCase('en-US'),
            candidate.toLocaleUpperCase('en-US'),
          ]) {
            if ([...transformed].length === 1) variants.add(transformed)
          }
          for (const reverse of REVERSE_SIMPLE_CASE_VARIANTS[candidate] ?? []) {
            variants.add(reverse)
          }
        }
      }
      return [...variants]
    }),
  )
}

function unicodeContains(column: string): string {
  return `EXISTS (
    WITH RECURSIVE positions(position, last) AS (
      SELECT 1, length(${column}) - json_array_length(?) + 1
      UNION ALL
      SELECT position + 1, last FROM positions WHERE position < last
    )
    SELECT 1
      FROM positions
     WHERE position <= last
       AND NOT EXISTS (
         SELECT 1
           FROM json_each(?) expected
          WHERE NOT EXISTS (
            SELECT 1
              FROM json_each(expected.value) variant
             WHERE substr(${column}, position + CAST(expected.key AS INTEGER), 1) =
                   CAST(variant.value AS TEXT)
          )
       )
  )`
}

function buildFilter(query: SubmissionDeskQuery): SqlFilter {
  const predicates: string[] = []
  const binds: unknown[] = []
  if (query.q !== '') {
    if (requiresUnicodeCaseSearch(query.q)) {
      const matrix = unicodeCaseMatrix(query.q)
      predicates.push(`(
        ${unicodeContains('s.title')} OR
        ${unicodeContains('primary_contact.name')} OR
        ${unicodeContains('primary_contact.email')}
      )`)
      binds.push(matrix, matrix, matrix, matrix, matrix, matrix)
    } else {
      predicates.push(`(
        instr(lower(s.title), lower(?)) > 0 OR
        instr(lower(primary_contact.name), lower(?)) > 0 OR
        instr(lower(primary_contact.email), lower(?)) > 0
      )`)
      binds.push(query.q, query.q, query.q)
    }
  }
  if (query.decision !== 'all') {
    predicates.push(`${LATEST_DECISION_SQL} = ?`)
    binds.push(query.decision)
  }
  if (query.routing !== 'all') {
    predicates.push(`json_extract(s.routing_json, '$.actionTarget') = ?`)
    binds.push(query.routing)
  }
  for (const facet of query.facets) {
    predicates.push(`EXISTS (
      SELECT 1
        FROM cfp_elements selected_field
        JOIN json_each(s.answers_json) selected_answer
          ON selected_answer.key = selected_field.field_key
       WHERE selected_field.event_id = s.event_id
         AND selected_field.id = ?
         AND selected_field.version_id = s.form_version_id
         AND selected_field.question_type IN ('single_choice', 'multi_choice')
         AND EXISTS (
           SELECT 1
             FROM json_each(?) requested_value
            WHERE (
              selected_answer.type = 'text'
              AND CAST(selected_answer.value AS TEXT) = CAST(requested_value.value AS TEXT)
            ) OR (
              selected_answer.type = 'array'
              AND EXISTS (
                SELECT 1 FROM json_each(selected_answer.value) actual_value
                 WHERE CAST(actual_value.value AS TEXT) = CAST(requested_value.value AS TEXT)
              )
            )
         )
    )`)
    binds.push(facet.elementId, JSON.stringify(facet.values))
  }
  const orderBy =
    query.sort === 'submitted-asc'
      ? 'submitted_at ASC, id ASC'
      : query.sort === 'title-asc'
        ? 'title COLLATE NOCASE ASC, id ASC'
        : query.sort === 'decision-asc'
          ? `CASE decision WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END ASC, id ASC`
          : 'submitted_at DESC, id ASC'
  return {
    where: predicates.length === 0 ? '' : ` AND ${predicates.join(' AND ')}`,
    binds,
    orderBy,
  }
}

function filteredCte(filter: SqlFilter): string {
  return `
    WITH filtered AS (
      SELECT s.id, s.event_id, s.owner_contact_id, s.form_version_id, s.origin_draft_id,
             s.status, s.source, s.title, s.answers_json, s.content_hash, s.routing_json,
             s.created_at, s.submitted_at,
             version.form_id, version.version AS form_version, form.slug AS form_slug,
             primary_contributor.contact_id AS primary_contact_id,
             primary_contact.name AS primary_name,
             primary_contact.email AS primary_email,
             ${LATEST_DECISION_SQL} AS decision
        FROM proposal_submissions s
        JOIN cfp_form_versions version
          ON version.event_id = s.event_id AND version.id = s.form_version_id
        JOIN cfp_forms form
          ON form.event_id = version.event_id AND form.id = version.form_id
        JOIN submission_contributors primary_contributor
          ON primary_contributor.event_id = s.event_id
         AND primary_contributor.submission_id = s.id
         AND primary_contributor.role = 'primary'
         AND primary_contributor.position = 0
        JOIN contacts primary_contact ON primary_contact.id = primary_contributor.contact_id
       WHERE s.event_id = ? AND s.source = 'cfp'${filter.where}
    )`
}

function matchingCountSql(filter: SqlFilter): string {
  return `${filteredCte(filter)} SELECT COUNT(*) AS total FROM filtered`
}

function rowsSql(filter: SqlFilter): string {
  return `${filteredCte(filter)}, resolved AS (
      SELECT COUNT(*) AS snapshot_matching_total,
             CASE WHEN COUNT(*) = 0 THEN 1
                  ELSE MIN(?, CAST((COUNT(*) + ${SUBMISSION_DESK_PAGE_SIZE - 1}) /
                                        ${SUBMISSION_DESK_PAGE_SIZE} AS INTEGER))
              END AS resolved_page
        FROM filtered
    ), page_rows AS (
      SELECT filtered.*, resolved.snapshot_matching_total, resolved.resolved_page
        FROM filtered CROSS JOIN resolved
       ORDER BY ${filter.orderBy}
       LIMIT ${SUBMISSION_DESK_PAGE_SIZE}
      OFFSET ((SELECT resolved_page FROM resolved) - 1) * ${SUBMISSION_DESK_PAGE_SIZE}
    ), co_speakers AS (
      SELECT contributor.event_id, contributor.submission_id,
             COUNT(*) AS co_speaker_count
        FROM submission_contributors contributor
        JOIN page_rows page
          ON page.event_id = contributor.event_id AND page.id = contributor.submission_id
       WHERE contributor.role = 'co-speaker'
       GROUP BY contributor.event_id, contributor.submission_id
    )
    SELECT page_rows.*,
           COALESCE(co_speakers.co_speaker_count, 0) AS co_speaker_count
      FROM page_rows
      LEFT JOIN co_speakers
        ON co_speakers.event_id = page_rows.event_id
       AND co_speakers.submission_id = page_rows.id
     ORDER BY ${filter.orderBy}`
}

const FIELDS_SQL = `
  SELECT element.id AS element_id, element.version_id, version.form_id,
         form.slug AS form_slug, version.version, element.field_key,
         element.label, element.question_type, element.position, element.options_json
    FROM cfp_elements element
    JOIN cfp_form_versions version
      ON version.event_id = element.event_id AND version.id = element.version_id
    JOIN cfp_forms form
      ON form.event_id = version.event_id AND form.id = version.form_id
   WHERE element.event_id = ?
     AND element.field_key IS NOT NULL
     AND element.label IS NOT NULL
     AND element.question_type IN ('single_choice', 'multi_choice')
     AND EXISTS (
       SELECT 1 FROM proposal_submissions submission
        WHERE submission.event_id = element.event_id
          AND submission.form_version_id = element.version_id
          AND submission.source = 'cfp'
     )
   ORDER BY form.slug ASC, version.version ASC, element.position ASC, element.id ASC`

const FACET_COUNTS_SQL = `
  WITH choice_fields AS (
    SELECT element.event_id, element.id, element.version_id, element.field_key
      FROM cfp_elements element
     WHERE element.event_id = ?
       AND element.field_key IS NOT NULL
       AND element.question_type IN ('single_choice', 'multi_choice')
  ), observed AS (
    SELECT submission.id AS submission_id, field.id AS element_id,
           CASE WHEN answer.type = 'array' THEN nested.value ELSE answer.value END AS value
      FROM proposal_submissions submission
      JOIN choice_fields field
        ON field.event_id = submission.event_id
       AND field.version_id = submission.form_version_id
      JOIN json_each(submission.answers_json) answer ON answer.key = field.field_key
      LEFT JOIN json_each(CASE WHEN answer.type = 'array' THEN answer.value ELSE '[]' END) nested
        ON TRUE
     WHERE submission.event_id = ? AND submission.source = 'cfp'
       AND answer.type IN ('text', 'array')
  )
  SELECT element_id, CAST(value AS TEXT) AS value, COUNT(DISTINCT submission_id) AS count
    FROM observed
   WHERE value IS NOT NULL AND CAST(value AS TEXT) != ''
   GROUP BY element_id, CAST(value AS TEXT)
   ORDER BY element_id ASC, value ASC`

const ROUTING_COUNTS_SQL = `
  SELECT json_extract(routing_json, '$.actionTarget') AS value, COUNT(*) AS count
    FROM proposal_submissions
   WHERE event_id = ? AND source = 'cfp'
     AND json_type(routing_json, '$.actionTarget') = 'text'
     AND json_extract(routing_json, '$.actionTarget') != ''
   GROUP BY json_extract(routing_json, '$.actionTarget')
   ORDER BY value ASC`

const TOTAL_SQL = `
  SELECT COUNT(*) AS total FROM proposal_submissions WHERE event_id = ? AND source = 'cfp'`

const HYDRATABLE_COUNT_SQL = `
  SELECT COUNT(*) AS total
    FROM proposal_submissions submission
    JOIN submission_contributors contributor
      ON contributor.event_id = submission.event_id
     AND contributor.submission_id = submission.id
     AND contributor.role = 'primary'
     AND contributor.position = 0
    JOIN contacts contact ON contact.id = contributor.contact_id
   WHERE submission.event_id = ? AND submission.source = 'cfp'`

export function createSubmissionDeskRepository(db: D1Database): SubmissionDeskRepository {
  return {
    async listByEvent(eventId, query) {
      const filter = buildFilter(query)
      const countBinds = [eventId, ...filter.binds]
      const [
        matchingResult,
        fieldResult,
        facetResult,
        routingResult,
        totalResult,
        hydratedResult,
        rowResult,
      ] = await db.batch([
        db.prepare(matchingCountSql(filter)).bind(...countBinds),
        db.prepare(FIELDS_SQL).bind(eventId),
        db.prepare(FACET_COUNTS_SQL).bind(eventId, eventId),
        db.prepare(ROUTING_COUNTS_SQL).bind(eventId),
        db.prepare(TOTAL_SQL).bind(eventId),
        db.prepare(HYDRATABLE_COUNT_SQL).bind(eventId),
        db.prepare(rowsSql(filter)).bind(...countBinds, query.page),
      ])
      if (
        matchingResult === undefined ||
        fieldResult === undefined ||
        facetResult === undefined ||
        routingResult === undefined ||
        totalResult === undefined ||
        hydratedResult === undefined ||
        rowResult === undefined
      ) {
        throw new DbDecodeError('submission desk metadata batch returned an incomplete result set')
      }
      const matchingTotal = (matchingResult.results as unknown as RawCountRow[])[0]?.total ?? 0
      const total = (totalResult.results as unknown as RawCountRow[])[0]?.total ?? 0
      const hydratable = (hydratedResult.results as unknown as RawCountRow[])[0]?.total ?? 0
      if (hydratable !== total) {
        throw new DbDecodeError('submission desk could not hydrate every event submission')
      }
      const pageCount = Math.ceil(matchingTotal / SUBMISSION_DESK_PAGE_SIZE)
      const page = pageCount === 0 ? 1 : Math.min(query.page, pageCount)
      const rawRows = rowResult.results as unknown as RawDeskRow[]
      const offset = (page - 1) * SUBMISSION_DESK_PAGE_SIZE
      const expectedRows = Math.min(SUBMISSION_DESK_PAGE_SIZE, Math.max(0, matchingTotal - offset))
      const snapshotMatchingTotal = rawRows[0]?.snapshot_matching_total
      const resolvedPage = rawRows[0]?.resolved_page
      if (
        rawRows.length !== expectedRows ||
        (snapshotMatchingTotal !== undefined && snapshotMatchingTotal !== matchingTotal) ||
        (resolvedPage !== undefined && resolvedPage !== page)
      ) {
        throw new DbDecodeError('submission desk could not hydrate the complete filtered page')
      }
      return {
        records: rawRows.map(deskRecord),
        choiceFields: (fieldResult.results as unknown as RawChoiceFieldRow[]).map(choiceField),
        facetCounts: (facetResult.results as unknown as RawFacetCountRow[]).map(
          (row): SubmissionDeskFacetCount => ({
            elementId: row.element_id,
            value: row.value,
            count: row.count,
          }),
        ),
        routingOptions: (routingResult.results as unknown as RawRoutingCountRow[]).map(
          (row): SubmissionFacetOptionDto => ({ value: row.value, count: row.count }),
        ),
        total,
        matchingTotal,
        page,
        pageCount,
      }
    },
  }
}
