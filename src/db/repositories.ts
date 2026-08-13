import type { D1Database } from '@cloudflare/workers-types'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

import type { FormElement } from '../domain/form-version'
import type { CapturedMessageRepository } from '../application/ports/captured-message-repository'
import type { ConfirmationRepository } from '../application/ports/confirmation-repository'
import type { ContactRepository } from '../application/ports/contact-repository'
import type { DraftRepository } from '../application/ports/draft-repository'
import type { EventConfigRepository } from '../application/ports/event-config-repository'
import type { EventRepository } from '../application/ports/event-repository'
import type { FormContentRepository } from '../application/ports/form-content-repository'
import type { FormRepository } from '../application/ports/form-repository'
import type { FormVersionRepository } from '../application/ports/form-version-repository'
import type { SessionRepository } from '../application/ports/session-repository'
import type { SubmissionRepository } from '../application/ports/submission-repository'
import type { TaxonomyRepository } from '../application/ports/taxonomy-repository'
import type { TokenRepository } from '../application/ports/token-repository'
import type {
  Event,
  EventId,
  EventSlug,
  SubmissionDecision,
  SubmissionDecisionOutcome,
} from '../domain'
import {
  toCapturedMessage,
  toCfpForm,
  toConfirmationRecord,
  toContact,
  toElementRules,
  toEvent,
  toFormElement,
  toFormPage,
  toFormVersion,
  toProposalDraft,
  toProposalSubmission,
  toRoutingRule,
  toSession,
  toSubmissionContributor,
  toSubmitterToken,
  toTaxonomyItem,
} from './mappers'
import {
  capturedMessages,
  cfpConditionRules,
  cfpElements,
  cfpForms,
  cfpFormVersions,
  cfpPages,
  cfpRoutingRules,
  confirmationRecords,
  contacts,
  events,
  proposalDrafts,
  proposalSubmissions,
  sessions,
  submissionContributors,
  submitterTokens,
  taxonomyItems,
} from './schema'

function eventInsertValues(event: Event) {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    timezone: event.timezone,
    status: event.status,
    startsAt: event.dates?.startsAt ?? null,
    endsAt: event.dates?.endsAt ?? null,
    websiteUrl: event.websiteUrl ?? null,
    organizerContact: event.organizerContact ?? null,
    venue: event.venue ?? null,
    eventType: event.eventType ?? null,
  }
}

interface RawDecisionRow {
  readonly event_id: string
  readonly id: string
  readonly submission_id: string
  readonly sequence: number
  readonly outcome: SubmissionDecisionOutcome
  readonly decided_by: string
  readonly decided_at: string
}

const DECISION_COLUMNS = 'event_id, id, submission_id, sequence, outcome, decided_by, decided_at'

/**
 * The predicate that picks the STANDING verdict out of the append-only trail:
 * the highest sequence for that submission. Written as a correlated subquery
 * rather than a window function so both adapters and every SQLite build agree.
 */
/** The decision columns qualified by a join alias. */
function d(alias: string): string {
  return DECISION_COLUMNS.split(', ')
    .map((column) => `${alias}.${column}`)
    .join(', ')
}

const LATEST_DECISION_PREDICATE = `d.sequence = (
  SELECT MAX(x.sequence) FROM submission_decisions x
   WHERE x.event_id = d.event_id AND x.submission_id = d.submission_id)`

function toSubmissionDecision(row: RawDecisionRow): SubmissionDecision {
  return {
    id: row.id,
    eventId: row.event_id,
    submissionId: row.submission_id,
    sequence: row.sequence,
    outcome: row.outcome,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  }
}

/** Read-only `EventRepository` (M1 surface). */
export function createEventRepository(db: D1Database): EventRepository {
  const database = drizzle(db)
  return {
    async findById(id: EventId): Promise<Event | null> {
      const rows = await database.select().from(events).where(eq(events.id, id)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toEvent(row)
    },
    async findBySlug(slug: EventSlug): Promise<Event | null> {
      const rows = await database.select().from(events).where(eq(events.slug, slug)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toEvent(row)
    },
  }
}

/** Event read/write port for the admin configuration surface. */
export function createEventConfigRepository(db: D1Database): EventConfigRepository {
  const database = drizzle(db)
  return {
    async findById(id: EventId): Promise<Event | null> {
      const rows = await database.select().from(events).where(eq(events.id, id)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toEvent(row)
    },
    async findBySlug(slug: EventSlug): Promise<Event | null> {
      const rows = await database.select().from(events).where(eq(events.slug, slug)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toEvent(row)
    },
    async save(event: Event): Promise<void> {
      const values = eventInsertValues(event)
      await database
        .insert(events)
        .values(values)
        .onConflictDoUpdate({
          target: events.id,
          set: {
            slug: values.slug,
            name: values.name,
            timezone: values.timezone,
            status: values.status,
            startsAt: values.startsAt,
            endsAt: values.endsAt,
            websiteUrl: values.websiteUrl,
            organizerContact: values.organizerContact,
            venue: values.venue,
            eventType: values.eventType,
          },
        })
    },
  }
}

export function createContactRepository(db: D1Database): ContactRepository {
  const database = drizzle(db)
  return {
    /**
     * The event's programme, one row per person, in ONE statement.
     *
     * Everyone who is on a proposal is a speaker of this event — that is the
     * definition the rest of the product already uses, so the roster cannot
     * disagree with the submissions list about who exists. The counts are
     * correlated subqueries over the same event scope rather than a query per
     * person, because a roster that costs a round trip per row stops loading
     * long before a programme stops growing.
     */
    async listSpeakersByEvent(eventId: string) {
      const result = await db
        .prepare(
          `SELECT c.id                    AS contact_id,
                  c.email                 AS email,
                  COALESCE(c.name, '')    AS name,
                  c.bio                   AS bio,
                  COUNT(DISTINCT sc.submission_id) AS proposal_count,
                  (SELECT COUNT(*) FROM agenda_session_speakers a
                    WHERE a.event_id = ? AND a.contact_id = c.id) AS session_count,
                  (SELECT COUNT(*) FROM speaker_tasks t
                    WHERE t.event_id = ? AND t.contact_id = c.id) AS task_count,
                  (SELECT COUNT(*) FROM speaker_tasks t
                    WHERE t.event_id = ? AND t.contact_id = c.id
                      AND t.status = 'completed') AS task_done_count,
                  (SELECT COUNT(*) FROM uploaded_files f
                    WHERE f.event_id = ? AND f.owner_contact_id = c.id
                      AND f.kind = 'headshot') AS headshot_count
             FROM submission_contributors sc
             JOIN contacts c ON c.id = sc.contact_id
            WHERE sc.event_id = ?
            GROUP BY c.id
            ORDER BY LOWER(COALESCE(c.name, '')), LOWER(c.email)`,
        )
        .bind(eventId, eventId, eventId, eventId, eventId)
        .all<{
          contact_id: string
          email: string
          name: string
          bio: string | null
          proposal_count: number
          session_count: number
          task_count: number
          task_done_count: number
          headshot_count: number
        }>()
      return result.results.map((row) => ({
        contactId: row.contact_id,
        email: row.email,
        name: row.name,
        bio: row.bio ?? null,
        proposalCount: row.proposal_count,
        sessionCount: row.session_count,
        taskCount: row.task_count,
        taskCompletedCount: row.task_done_count,
        hasHeadshot: row.headshot_count > 0,
      }))
    },

    async findById(id: string) {
      const rows = await database.select().from(contacts).where(eq(contacts.id, id)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toContact(row)
    },
    async findByEmail(email: string) {
      const rows = await database.select().from(contacts).where(eq(contacts.email, email)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toContact(row)
    },
    async updateProfile(id: string, fields: { name: string; bio: string | null }) {
      await database
        .update(contacts)
        .set({ name: fields.name, bio: fields.bio })
        .where(eq(contacts.id, id))
    },
    async ensureByEmail(input) {
      // Insert-if-absent on the email key, then read the row that actually
      // won: two organizers inviting the same reviewer at once must converge
      // on one identity rather than race to create two.
      await db
        .prepare(
          `INSERT INTO contacts (id, email, name, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(email) DO NOTHING`,
        )
        .bind(input.id, input.email, input.name, input.createdAt)
        .run()
      const rows = await database
        .select()
        .from(contacts)
        .where(eq(contacts.email, input.email))
        .limit(1)
      const row = rows[0]
      if (row === undefined) throw new Error('contact upsert stored no row')
      return toContact(row)
    },
  }
}

export function createTokenRepository(db: D1Database): TokenRepository {
  const database = drizzle(db)
  return {
    async findByHash(tokenHash: string) {
      const rows = await database
        .select()
        .from(submitterTokens)
        .where(and(eq(submitterTokens.tokenHash, tokenHash), isNotNull(submitterTokens.formId)))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toSubmitterToken(row)
    },
  }
}

export function createSessionRepository(db: D1Database): SessionRepository {
  const database = drizzle(db)
  return {
    async save(session) {
      const values =
        session.kind === 'submitter'
          ? {
              id: session.id,
              kind: 'submitter' as const,
              contactId: session.contactId,
              eventId: session.eventId,
              tokenHash: session.tokenHash,
              expiresAt: session.expiresAt,
              consumedAt: session.consumedAt,
              createdAt: session.createdAt,
            }
          : {
              id: session.id,
              kind: 'organizer' as const,
              contactId: null,
              eventId: null,
              tokenHash: session.tokenHash,
              expiresAt: session.expiresAt,
              consumedAt: session.consumedAt,
              createdAt: session.createdAt,
            }
      await database.insert(sessions).values(values)
    },
    async findByHash(tokenHash: string) {
      const rows = await database
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toSession(row)
    },
    async consumeByHash(tokenHash, consumedAt) {
      await database
        .update(sessions)
        .set({ consumedAt })
        .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.consumedAt)))
    },
  }
}

export function createCapturedMessageRepository(db: D1Database): CapturedMessageRepository {
  const database = drizzle(db)
  return {
    async listByEmail(email: string) {
      const rows = await database
        .select()
        .from(capturedMessages)
        .where(eq(capturedMessages.toEmail, email))
        .orderBy(asc(capturedMessages.createdAt))
      return rows.map(toCapturedMessage)
    },
    /** Append-only insert; the (submission, kind, recipient) unique index rejects a repeat. */
    async save(message) {
      await database.insert(capturedMessages).values({
        id: message.id,
        eventId: message.eventId,
        toEmail: message.toEmail,
        subject: message.subject,
        body: message.body,
        createdAt: message.createdAt,
        kind: message.kind,
        submissionId: message.submissionId ?? null,
      })
    },
    async findBySubmissionKindEmail(submissionId: string, kind, toEmail: string) {
      const rows = await database
        .select()
        .from(capturedMessages)
        .where(
          and(
            eq(capturedMessages.submissionId, submissionId),
            eq(capturedMessages.kind, kind),
            eq(capturedMessages.toEmail, toEmail),
          ),
        )
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toCapturedMessage(row)
    },
    async listByEvent(eventId: string, limit: number) {
      const rows = await database
        .select()
        .from(capturedMessages)
        .where(eq(capturedMessages.eventId, eventId))
        .orderBy(desc(capturedMessages.createdAt))
        .limit(limit)
      return rows.map(toCapturedMessage)
    },

    async listBySubmissionId(submissionId: string) {
      const rows = await database
        .select()
        .from(capturedMessages)
        .where(eq(capturedMessages.submissionId, submissionId))
        .orderBy(asc(capturedMessages.createdAt))
      return rows.map(toCapturedMessage)
    },
  }
}

export function createConfirmationRepository(db: D1Database): ConfirmationRepository {
  const database = drizzle(db)
  return {
    async findBySubmissionId(submissionId: string) {
      const rows = await database
        .select()
        .from(confirmationRecords)
        .where(eq(confirmationRecords.submissionId, submissionId))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toConfirmationRecord(row)
    },
  }
}

export function createDraftRepository(db: D1Database): DraftRepository {
  const database = drizzle(db)
  return {
    async findById(id: string) {
      const rows = await database
        .select()
        .from(proposalDrafts)
        .where(eq(proposalDrafts.id, id))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toProposalDraft(row)
    },
    async listByOwner(eventId: string, ownerContactId: string) {
      const rows = await database
        .select()
        .from(proposalDrafts)
        .where(
          and(
            eq(proposalDrafts.eventId, eventId),
            eq(proposalDrafts.ownerContactId, ownerContactId),
          ),
        )
        .orderBy(desc(proposalDrafts.updatedAt))
      return rows.map(toProposalDraft)
    },
    async save(draft, expectedUpdatedAt) {
      const answersJson = JSON.stringify(draft.answers)
      if (expectedUpdatedAt === null) {
        const result = await db
          .prepare(
            `INSERT INTO proposal_drafts
               (id, event_id, owner_contact_id, form_version_id, title, answers_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(event_id, id) DO NOTHING`,
          )
          .bind(
            draft.id,
            draft.eventId,
            draft.ownerContactId,
            draft.formVersionId,
            draft.title,
            answersJson,
            draft.createdAt,
            draft.updatedAt,
          )
          .run()
        return result.meta.changes === 1
      }
      const result = await db
        .prepare(
          `UPDATE proposal_drafts
           SET title = ?, answers_json = ?, form_version_id = ?, updated_at = ?
           WHERE event_id = ? AND id = ? AND owner_contact_id = ? AND updated_at = ?`,
        )
        .bind(
          draft.title,
          answersJson,
          draft.formVersionId,
          draft.updatedAt,
          draft.eventId,
          draft.id,
          draft.ownerContactId,
          expectedUpdatedAt,
        )
        .run()
      return result.meta.changes === 1
    },
  }
}

export function createSubmissionRepository(db: D1Database): SubmissionRepository {
  const database = drizzle(db)
  return {
    async findById(id: string) {
      const rows = await database
        .select()
        .from(proposalSubmissions)
        .where(eq(proposalSubmissions.id, id))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toProposalSubmission(row)
    },
    async findByOriginDraftId(originDraftId: string) {
      const rows = await database
        .select()
        .from(proposalSubmissions)
        .where(eq(proposalSubmissions.originDraftId, originDraftId))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toProposalSubmission(row)
    },
    async listByEvent(eventId: string) {
      const rows = await database
        .select()
        .from(proposalSubmissions)
        .where(eq(proposalSubmissions.eventId, eventId))
        .orderBy(desc(proposalSubmissions.submittedAt))
      return rows.map(toProposalSubmission)
    },
    async listByOwner(eventId: string, ownerContactId: string) {
      const rows = await database
        .select()
        .from(proposalSubmissions)
        .where(
          and(
            eq(proposalSubmissions.eventId, eventId),
            eq(proposalSubmissions.ownerContactId, ownerContactId),
          ),
        )
        .orderBy(desc(proposalSubmissions.submittedAt), asc(proposalSubmissions.id))
      return rows.map(toProposalSubmission)
    },
    async updateOwnContent(input) {
      // event + id + owner all in the predicate: the ownership test IS the write.
      const result = await database
        .update(proposalSubmissions)
        .set({ title: input.title, answersJson: JSON.stringify(input.answers) })
        .where(
          and(
            eq(proposalSubmissions.eventId, input.eventId),
            eq(proposalSubmissions.id, input.submissionId),
            eq(proposalSubmissions.ownerContactId, input.ownerContactId),
          ),
        )
      return (result.meta?.changes ?? 0) > 0 ? 'updated' : 'not-found'
    },
    async listContributorsBySubmission(eventId: string, submissionId: string) {
      const rows = await database
        .select()
        .from(submissionContributors)
        .where(
          and(
            eq(submissionContributors.eventId, eventId),
            eq(submissionContributors.submissionId, submissionId),
          ),
        )
        .orderBy(asc(submissionContributors.position))
      return rows.map(toSubmissionContributor)
    },
    async findDecision(eventId: string, submissionId: string) {
      const row = await db
        .prepare(
          `SELECT ${DECISION_COLUMNS} FROM submission_decisions
            WHERE event_id = ? AND submission_id = ?
            ORDER BY sequence DESC LIMIT 1`,
        )
        .bind(eventId, submissionId)
        .first<RawDecisionRow>()
      return row === null ? null : toSubmissionDecision(row)
    },
    async listDecisionHistory(eventId: string, submissionId: string) {
      const result = await db
        .prepare(
          `SELECT ${DECISION_COLUMNS} FROM submission_decisions
            WHERE event_id = ? AND submission_id = ? ORDER BY sequence`,
        )
        .bind(eventId, submissionId)
        .all<RawDecisionRow>()
      return result.results.map(toSubmissionDecision)
    },
    async listDecisionsByOwner(eventId: string, ownerContactId: string) {
      // Owner scope and event scope are both in the predicate that reads: a
      // speaker must never be able to see a verdict on someone else's proposal.
      const result = await db
        .prepare(
          `SELECT ${d('d')} FROM submission_decisions d
             JOIN proposal_submissions s
               ON s.event_id = d.event_id AND s.id = d.submission_id
            WHERE d.event_id = ? AND s.owner_contact_id = ? AND ${LATEST_DECISION_PREDICATE}`,
        )
        .bind(eventId, ownerContactId)
        .all<RawDecisionRow>()
      return result.results.map(toSubmissionDecision)
    },
    async listDecisionsByEvent(eventId: string) {
      const result = await db
        .prepare(
          `SELECT ${d('d')} FROM submission_decisions d
            WHERE d.event_id = ? AND ${LATEST_DECISION_PREDICATE}`,
        )
        .bind(eventId)
        .all<RawDecisionRow>()
      return result.results.map(toSubmissionDecision)
    },
    async recordDecision(input) {
      // Append, never overwrite: `sequence` is computed inside the statement
      // from the rows already there, so the trail stays gapless under a
      // concurrent second write instead of two verdicts claiming one slot —
      // the UNIQUE (event, submission, sequence) rejects the loser outright.
      //
      // The EXISTS guard is the event scope: a submission id that does not live
      // in this event inserts nothing, so the zero-row result IS the refusal.
      const result = await db
        .prepare(
          `INSERT INTO submission_decisions
             (event_id, id, submission_id, sequence, outcome, decided_by, decided_at)
           SELECT ?, ?, ?,
             COALESCE((SELECT MAX(x.sequence) FROM submission_decisions x
                        WHERE x.event_id = ? AND x.submission_id = ?), 0) + 1,
             ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM proposal_submissions WHERE event_id = ? AND id = ?)`,
        )
        .bind(
          input.eventId,
          input.id,
          input.submissionId,
          input.eventId,
          input.submissionId,
          input.outcome,
          input.decidedBy,
          input.decidedAt,
          input.eventId,
          input.submissionId,
        )
        .run()
      return result.meta.changes > 0 ? 'recorded' : 'not-found'
    },
  }
}

export function createFormRepository(db: D1Database): FormRepository {
  const database = drizzle(db)
  return {
    async findById(id: string) {
      const rows = await database.select().from(cfpForms).where(eq(cfpForms.id, id)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toCfpForm(row)
    },
    async findByEventAndSlug(eventId: string, slug: string) {
      const rows = await database
        .select()
        .from(cfpForms)
        .where(and(eq(cfpForms.eventId, eventId), eq(cfpForms.slug, slug)))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toCfpForm(row)
    },
    async listByEvent(eventId: string) {
      const rows = await database
        .select()
        .from(cfpForms)
        .where(eq(cfpForms.eventId, eventId))
        .orderBy(asc(cfpForms.slug))
      return rows.map(toCfpForm)
    },
    async updateWindow(input) {
      // Both keys in the predicate: naming this event's slug in the path while
      // passing another event's form id must move nothing.
      const result = await database
        .update(cfpForms)
        .set({ opensAt: input.opensAt, closesAt: input.closesAt })
        .where(and(eq(cfpForms.eventId, input.eventId), eq(cfpForms.id, input.formId)))
      const changes = result.meta?.changes ?? 0
      return changes > 0 ? 'updated' : 'not-found'
    },
  }
}

export function createFormVersionRepository(db: D1Database): FormVersionRepository {
  const database = drizzle(db)
  return {
    async findById(id: string) {
      const rows = await database
        .select()
        .from(cfpFormVersions)
        .where(eq(cfpFormVersions.id, id))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toFormVersion(row)
    },
    async listByForm(formId: string) {
      const rows = await database
        .select()
        .from(cfpFormVersions)
        .where(eq(cfpFormVersions.formId, formId))
        .orderBy(asc(cfpFormVersions.version))
      return rows.map(toFormVersion)
    },
    async findLatestDraftByForm(formId: string) {
      const rows = await database
        .select()
        .from(cfpFormVersions)
        .where(and(eq(cfpFormVersions.formId, formId), eq(cfpFormVersions.status, 'draft')))
        .orderBy(desc(cfpFormVersions.version))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toFormVersion(row)
    },
    async findByFormAndVersion(formId: string, version: number) {
      const rows = await database
        .select()
        .from(cfpFormVersions)
        .where(and(eq(cfpFormVersions.formId, formId), eq(cfpFormVersions.version, version)))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toFormVersion(row)
    },
  }
}

/**
 * Replaces the stored option list of every taxonomy-sourced question with the
 * event's live vocabulary, in the order the organizer put it in.
 *
 * THE single resolution point, and it is here rather than in a service on
 * purpose: `loadByVersion` has callers in the form builder (what the public
 * form OFFERS), in submit and in edit (what the server ACCEPTS), and in
 * onboarding. Resolving in one of them would leave the offer and the acceptance
 * reading different lists, which is a worse bug than the one being fixed —
 * a submitter would be shown a choice the server then refuses. Resolved here,
 * everything downstream keeps consuming one array and cannot disagree.
 *
 * Untouched when nothing is taxonomy-sourced, which is every form until an
 * organizer says otherwise, so the ordinary path costs no extra query.
 */
async function resolveTaxonomyOptions(
  database: ReturnType<typeof drizzle>,
  eventId: string,
  elements: readonly FormElement[],
): Promise<readonly FormElement[]> {
  if (!elements.some((element) => element.optionsSource !== null)) return elements
  const items = await database
    .select()
    .from(taxonomyItems)
    .where(eq(taxonomyItems.eventId, eventId))
    .orderBy(asc(taxonomyItems.position))
  const byKind = new Map<string, string[]>()
  for (const item of items) {
    const held = byKind.get(item.kind)
    // The LABEL, because the label is what a submitter reads and what the
    // answer stores. A key would make the stored answer an identifier nobody
    // can read on an organizer's screen.
    if (held === undefined) byKind.set(item.kind, [item.label])
    else held.push(item.label)
  }
  return elements.map((element) =>
    element.optionsSource === null
      ? element
      : { ...element, options: byKind.get(element.optionsSource) ?? [] },
  )
}

export function createFormContentRepository(db: D1Database): FormContentRepository {
  const database = drizzle(db)
  return {
    async loadByVersion(eventId: string, versionId: string) {
      const [pages, elements, conditionRules, routingRules] = await Promise.all([
        database
          .select()
          .from(cfpPages)
          .where(and(eq(cfpPages.eventId, eventId), eq(cfpPages.versionId, versionId)))
          .orderBy(asc(cfpPages.position)),
        database
          .select()
          .from(cfpElements)
          .where(and(eq(cfpElements.eventId, eventId), eq(cfpElements.versionId, versionId)))
          .orderBy(asc(cfpElements.position)),
        database
          .select()
          .from(cfpConditionRules)
          .where(
            and(eq(cfpConditionRules.eventId, eventId), eq(cfpConditionRules.versionId, versionId)),
          )
          .orderBy(asc(cfpConditionRules.groupIndex), asc(cfpConditionRules.conditionIndex)),
        database
          .select()
          .from(cfpRoutingRules)
          .where(
            and(eq(cfpRoutingRules.eventId, eventId), eq(cfpRoutingRules.versionId, versionId)),
          )
          .orderBy(asc(cfpRoutingRules.position)),
      ])
      const mapped = elements.map(toFormElement)
      return {
        pages: pages.map(toFormPage),
        elements: await resolveTaxonomyOptions(database, eventId, mapped),
        conditionRules: toElementRules(conditionRules),
        routingRules: routingRules.map(toRoutingRule),
      }
    },
  }
}

export function createTaxonomyRepository(db: D1Database): TaxonomyRepository {
  const database = drizzle(db)
  return {
    async listByEvent(eventId: string) {
      const rows = await database
        .select()
        .from(taxonomyItems)
        .where(eq(taxonomyItems.eventId, eventId))
        .orderBy(asc(taxonomyItems.kind), asc(taxonomyItems.position))
      return rows.map(toTaxonomyItem)
    },
    async replaceForEvent(eventId, items) {
      const statements = [
        db.prepare('DELETE FROM taxonomy_items WHERE event_id = ?').bind(eventId),
        ...items.map((item) =>
          db
            .prepare(
              `INSERT INTO taxonomy_items (event_id, id, kind, key, label, position)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(event_id, id) DO NOTHING`,
            )
            .bind(item.eventId, item.id, item.kind, item.key, item.label, item.position),
        ),
      ]
      await db.batch(statements)
    },
  }
}
