import type { D1Database } from '@cloudflare/workers-types'
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

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
import type { Event, EventId, EventSlug } from '../domain'
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
    /** Append-only insert; the unique submission index rejects a second send. */
    async save(message) {
      await database.insert(capturedMessages).values({
        id: message.id,
        eventId: message.eventId,
        toEmail: message.toEmail,
        subject: message.subject,
        body: message.body,
        createdAt: message.createdAt,
        submissionId: message.submissionId ?? null,
      })
    },
    async findBySubmissionId(submissionId: string) {
      const rows = await database
        .select()
        .from(capturedMessages)
        .where(eq(capturedMessages.submissionId, submissionId))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toCapturedMessage(row)
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
      return {
        pages: pages.map(toFormPage),
        elements: elements.map(toFormElement),
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
