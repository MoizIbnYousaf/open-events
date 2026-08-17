import type { D1Database } from '@cloudflare/workers-types'
import { and, asc, desc, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

import { ApplicationError } from '../application/errors'
import type { FormElement } from '../domain/form-version'
import type { CapturedMessageRepository } from '../application/ports/captured-message-repository'
import type { EmailDeliveryConfig } from '../application/ports/email-delivery-repository'
import { decryptMailPayload, fingerprintMailRecipient } from '../application/security/mail-payload'
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
  CapturedMessage,
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
import { appendEmailDeliveryStatements, prepareEmailDelivery } from './email-delivery-outbox'

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
    logoStorageKey: event.branding?.logo?.storageKey ?? null,
    logoContentType: event.branding?.logo?.contentType ?? null,
    logoWidth: event.branding?.logo?.width ?? null,
    logoHeight: event.branding?.logo?.height ?? null,
    logoUpdatedAt: event.branding?.logo?.updatedAt ?? null,
    backgroundStorageKey: event.branding?.background?.storageKey ?? null,
    backgroundContentType: event.branding?.background?.contentType ?? null,
    backgroundWidth: event.branding?.background?.width ?? null,
    backgroundHeight: event.branding?.background?.height ?? null,
    backgroundUpdatedAt: event.branding?.background?.updatedAt ?? null,
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
    async list(): Promise<readonly Event[]> {
      const rows = await database.select().from(events).orderBy(events.name)
      return rows.map(toEvent)
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
    async list(): Promise<readonly Event[]> {
      const rows = await database.select().from(events).orderBy(events.name)
      return rows.map(toEvent)
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
            logoStorageKey: values.logoStorageKey,
            logoContentType: values.logoContentType,
            logoWidth: values.logoWidth,
            logoHeight: values.logoHeight,
            logoUpdatedAt: values.logoUpdatedAt,
            backgroundStorageKey: values.backgroundStorageKey,
            backgroundContentType: values.backgroundContentType,
            backgroundWidth: values.backgroundWidth,
            backgroundHeight: values.backgroundHeight,
            backgroundUpdatedAt: values.backgroundUpdatedAt,
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
                      AND f.kind = 'headshot') AS headshot_count,
                  COALESCE(p.job_title, '') AS job_title,
                  COALESCE(p.company, '') AS company,
                  COALESCE(p.travel_notes, '') AS travel_notes,
                  COALESCE(p.workflow_status, 'invited') AS workflow_status
             FROM (
               SELECT contact_id FROM submission_contributors WHERE event_id = ?
               UNION
               SELECT contact_id FROM speaker_profiles WHERE event_id = ?
             ) members
             JOIN contacts c ON c.id = members.contact_id
             LEFT JOIN speaker_profiles p
               ON p.event_id = ? AND p.contact_id = c.id
             LEFT JOIN submission_contributors sc
               ON sc.event_id = ? AND sc.contact_id = c.id
            GROUP BY c.id
            ORDER BY LOWER(COALESCE(c.name, '')), LOWER(c.email)`,
        )
        .bind(eventId, eventId, eventId, eventId, eventId, eventId, eventId, eventId)
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
          job_title: string
          company: string
          travel_notes: string
          workflow_status: string
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
        jobTitle: row.job_title,
        company: row.company,
        travelNotes: row.travel_notes,
        workflowStatus: row.workflow_status,
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
    async upsertSpeakerProfile(input) {
      await db
        .prepare(
          `INSERT INTO speaker_profiles
             (event_id, contact_id, job_title, company, travel_notes, workflow_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id, contact_id) DO UPDATE SET
             job_title = excluded.job_title,
             company = excluded.company,
             travel_notes = excluded.travel_notes,
             workflow_status = excluded.workflow_status,
             updated_at = excluded.updated_at`,
        )
        .bind(
          input.eventId,
          input.contactId,
          input.jobTitle,
          input.company,
          input.travelNotes,
          input.workflowStatus,
          input.createdAt,
          input.updatedAt,
        )
        .run()
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
        .where(
          and(
            eq(submitterTokens.tokenHash, tokenHash),
            or(isNotNull(submitterTokens.formId), isNotNull(submitterTokens.purpose)),
          ),
        )
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
              capability: session.capability,
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
              capability: null,
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

export function createCapturedMessageRepository(
  db: D1Database,
  emailDelivery: EmailDeliveryConfig,
): CapturedMessageRepository {
  const database = drizzle(db)
  return {
    async listByEmail(email: string) {
      const fingerprint = await fingerprintMailRecipient(email, emailDelivery.payloadKey)
      const rows = await database
        .select()
        .from(capturedMessages)
        .where(
          or(
            eq(capturedMessages.recipientFingerprint, fingerprint),
            and(isNull(capturedMessages.recipientFingerprint), eq(capturedMessages.toEmail, email)),
          ),
        )
        .orderBy(asc(capturedMessages.createdAt))
        .limit(50)
      return Promise.all(
        rows.map(async (row) => {
          const audit = toCapturedMessage(row)
          if (row.recipientFingerprint === null) return audit
          const job = await db
            .prepare(
              `SELECT id, captured_message_id, mode, recipient_fingerprint,
                      key_version, nonce, ciphertext, payload_expires_at
               FROM email_delivery_jobs WHERE captured_message_id = ?`,
            )
            .bind(row.id)
            .first<{
              id: string
              captured_message_id: string
              mode: 'capture' | 'resend-test' | 'resend-live'
              recipient_fingerprint: string
              key_version: string
              nonce: string | null
              ciphertext: string | null
              payload_expires_at: string
            }>()
          if (job === null || job.nonce === null || job.ciphertext === null) return audit
          try {
            const payload = await decryptMailPayload(
              {
                jobId: job.id,
                messageId: job.captured_message_id,
                mode: job.mode,
                recipientFingerprint: job.recipient_fingerprint,
                recipientLabel: audit.toEmail,
                auditBody: audit.body,
                keyVersion: job.key_version,
                nonce: job.nonce,
                ciphertext: job.ciphertext,
                expiresAt: job.payload_expires_at,
              },
              emailDelivery.payloadKey,
            )
            return { ...audit, toEmail: payload.to, subject: payload.subject, body: payload.body }
          } catch {
            return audit
          }
        }),
      )
    },
    /** Append-only insert; the (submission, kind, recipient) unique index rejects a repeat. */
    async save(message) {
      const delivery = await prepareEmailDelivery(message, emailDelivery)
      const statements = [
        db
          .prepare(
            `INSERT INTO captured_messages
               (id, event_id, to_email, subject, body, created_at, kind,
                submission_id, recipient_fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            message.id,
            message.eventId,
            delivery.recipientLabel,
            message.subject,
            delivery.auditBody,
            message.createdAt,
            message.kind,
            message.submissionId ?? null,
            delivery.recipientFingerprint,
          ),
      ]
      appendEmailDeliveryStatements(db, statements, delivery)
      await db.batch(statements)
    },
    async findBySubmissionKindEmail(submissionId: string, kind, toEmail: string) {
      const fingerprint = await fingerprintMailRecipient(toEmail, emailDelivery.payloadKey)
      const rows = await database
        .select()
        .from(capturedMessages)
        .where(
          and(
            eq(capturedMessages.submissionId, submissionId),
            eq(capturedMessages.kind, kind),
            or(
              eq(capturedMessages.recipientFingerprint, fingerprint),
              and(
                isNull(capturedMessages.recipientFingerprint),
                eq(capturedMessages.toEmail, toEmail),
              ),
            ),
          ),
        )
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toCapturedMessage(row)
    },
    async findAccessBoundBySubmissionKindEmail(submissionId: string, kind, toEmail: string) {
      const fingerprint = await fingerprintMailRecipient(toEmail, emailDelivery.payloadKey)
      const rows = await database
        .select()
        .from(capturedMessages)
        .where(
          and(
            eq(capturedMessages.submissionId, submissionId),
            eq(capturedMessages.kind, kind),
            or(
              eq(capturedMessages.recipientFingerprint, fingerprint),
              and(
                isNull(capturedMessages.recipientFingerprint),
                eq(capturedMessages.toEmail, toEmail),
              ),
            ),
            isNotNull(capturedMessages.roleAccessTokenId),
          ),
        )
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toCapturedMessage(row)
    },
    async listByEvent(eventId: string, limit: number) {
      const result = await db
        .prepare(
          `SELECT cm.id, cm.event_id, cm.to_email, cm.subject, cm.body, cm.created_at,
                  cm.kind, cm.submission_id,
                  COALESCE(j.provider_status, j.status, 'captured') AS delivery_status
           FROM captured_messages cm
           LEFT JOIN email_delivery_jobs j ON j.captured_message_id = cm.id
           WHERE cm.event_id = ?
           ORDER BY cm.created_at DESC, cm.rowid DESC
           LIMIT ?`,
        )
        .bind(eventId, limit)
        .all<{
          id: string
          event_id: string
          to_email: string
          subject: string
          body: string
          created_at: string
          kind: CapturedMessage['kind']
          submission_id: string | null
          delivery_status: NonNullable<CapturedMessage['deliveryStatus']>
        }>()
      return result.results.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        toEmail: row.to_email,
        subject: row.subject,
        body: row.body,
        createdAt: row.created_at,
        kind: row.kind,
        submissionId: row.submission_id,
        deliveryStatus: row.delivery_status,
      }))
    },

    async listBySubmissionId(submissionId: string) {
      const result = await db
        .prepare(
          `SELECT cm.id, cm.event_id, cm.to_email, cm.subject, cm.body, cm.created_at,
                  cm.kind, cm.submission_id,
                  COALESCE(j.provider_status, j.status, 'captured') AS delivery_status
           FROM captured_messages cm
           LEFT JOIN email_delivery_jobs j ON j.captured_message_id = cm.id
           WHERE cm.submission_id = ?
           ORDER BY cm.created_at, cm.rowid`,
        )
        .bind(submissionId)
        .all<{
          id: string
          event_id: string
          to_email: string
          subject: string
          body: string
          created_at: string
          kind: CapturedMessage['kind']
          submission_id: string | null
          delivery_status: NonNullable<CapturedMessage['deliveryStatus']>
        }>()
      return result.results.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        toEmail: row.to_email,
        subject: row.subject,
        body: row.body,
        createdAt: row.created_at,
        kind: row.kind,
        submissionId: row.submission_id,
        deliveryStatus: row.delivery_status,
      }))
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
    async updateContent(input) {
      const result = await database
        .update(proposalSubmissions)
        .set({ title: input.title, answersJson: JSON.stringify(input.answers) })
        .where(
          and(
            eq(proposalSubmissions.eventId, input.eventId),
            eq(proposalSubmissions.id, input.submissionId),
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
      const existing = await this.listByEvent(eventId)
      const keep = new Set(items.map((item) => item.id))
      const statements = [
        ...existing
          .filter((item) => !keep.has(item.id))
          .map((item) =>
            db
              .prepare('DELETE FROM taxonomy_items WHERE event_id = ? AND id = ?')
              .bind(eventId, item.id),
          ),
        ...items.map((item) =>
          db
            .prepare(
              `INSERT INTO taxonomy_items (event_id, id, kind, key, label, position)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(event_id, id) DO UPDATE SET
                 kind = excluded.kind,
                 key = excluded.key,
                 label = excluded.label,
                 position = excluded.position`,
            )
            .bind(item.eventId, item.id, item.kind, item.key, item.label, item.position),
        ),
      ]
      if (statements.length === 0) return
      try {
        await db.batch(statements)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/FOREIGN KEY|constraint/i.test(message)) {
          throw new ApplicationError(
            'conflict',
            'A taxonomy item is still referenced by the programme',
          )
        }
        throw error
      }
    },
  }
}
