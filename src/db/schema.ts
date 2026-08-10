import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { UPLOADED_FILE_KINDS } from '../application/ports/uploaded-file-repository'
import {
  CONDITION_EFFECTS,
  CONDITION_OPERATORS,
  CONTACT_ROLES,
  ELEMENT_KINDS,
  EVENT_STATUSES,
  FORM_STATUSES,
  PAGE_KINDS,
  QUESTION_TYPES,
  ROUTING_ACTIONS,
  SESSION_KINDS,
  SPEAKER_TASK_KINDS,
  SPEAKER_TASK_STATUSES,
  SUBMISSION_STATUSES,
  TAXONOMY_KINDS,
  VERSION_STATUSES,
} from '../domain'

/**
 * Drizzle mirror of migrations/0002_create_m2_tables.sql. The migration is the
 * runtime source of truth (CHECKs, triggers, FKs); this schema drives typed
 * queries and row mapping in `src/db`.
 *
 * UTC instants are ISO-8601 TEXT. Event-scoped parents declare (event_id, id)
 * primary keys so children can reference them with composite FKs.
 */

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  status: text('status', { enum: [...EVENT_STATUSES] }).notNull(),
  startsAt: text('starts_at'),
  endsAt: text('ends_at'),
  websiteUrl: text('website_url'),
  organizerContact: text('organizer_contact'),
  venue: text('venue'),
  eventType: text('event_type'),
})

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
})

export const submitterTokens = sqliteTable(
  'submitter_tokens',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    contactId: text('contact_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at').notNull(),
    formId: text('form_id').references(() => cfpForms.id),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [events.id],
    }),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contacts.id],
    }),
    index('idx_submitter_tokens_event_contact').on(table.eventId, table.contactId),
  ],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: [...SESSION_KINDS] }).notNull(),
    contactId: text('contact_id'),
    eventId: text('event_id'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contacts.id],
    }),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [events.id],
    }),
  ],
)

export const taxonomyItems = sqliteTable(
  'taxonomy_items',
  {
    eventId: text('event_id').notNull(),
    id: text('id').notNull(),
    kind: text('kind', { enum: [...TAXONOMY_KINDS] }).notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    uniqueIndex('taxonomy_items_event_kind_key').on(table.eventId, table.kind, table.key),
  ],
)

export const cfpForms = sqliteTable(
  'cfp_forms',
  {
    eventId: text('event_id').notNull(),
    id: text('id').notNull(),
    slug: text('slug').notNull(),
    status: text('status', { enum: [...FORM_STATUSES] }).notNull(),
    publishedVersionId: text('published_version_id'),
    opensAt: text('opens_at'),
    closesAt: text('closes_at'),
    totalCap: integer('total_cap'),
    perIdentityLimit: integer('per_identity_limit'),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    uniqueIndex('idx_cfp_forms_id').on(table.id),
    uniqueIndex('cfp_forms_event_slug').on(table.eventId, table.slug),
  ],
)

export const cfpFormVersions = sqliteTable(
  'cfp_form_versions',
  {
    eventId: text('event_id').notNull(),
    id: text('id').notNull(),
    formId: text('form_id').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: [...VERSION_STATUSES] }).notNull(),
    contentHash: text('content_hash'),
    publishedAt: text('published_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    index('idx_cfp_form_versions_form_version').on(table.formId, table.version),
    uniqueIndex('idx_cfp_form_versions_id').on(table.id),
    uniqueIndex('cfp_form_versions_event_form_version').on(
      table.eventId,
      table.formId,
      table.version,
    ),
    foreignKey({
      columns: [table.eventId, table.formId],
      foreignColumns: [cfpForms.eventId, cfpForms.id],
    }),
  ],
)

export const cfpPages = sqliteTable(
  'cfp_pages',
  {
    eventId: text('event_id').notNull(),
    id: text('id').notNull(),
    versionId: text('version_id').notNull(),
    position: integer('position').notNull(),
    kind: text('kind', { enum: [...PAGE_KINDS] }).notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    index('idx_cfp_pages_event_version').on(table.eventId, table.versionId),
    uniqueIndex('cfp_pages_version_position').on(table.versionId, table.position),
    foreignKey({
      columns: [table.eventId, table.versionId],
      foreignColumns: [cfpFormVersions.eventId, cfpFormVersions.id],
    }),
  ],
)

export const cfpElements = sqliteTable(
  'cfp_elements',
  {
    eventId: text('event_id').notNull(),
    id: text('id').notNull(),
    versionId: text('version_id').notNull(),
    pageId: text('page_id').notNull(),
    position: integer('position').notNull(),
    kind: text('kind', { enum: [...ELEMENT_KINDS] }).notNull(),
    fieldKey: text('field_key'),
    label: text('label'),
    required: integer('required').notNull(),
    maxLength: integer('max_length'),
    questionType: text('question_type', { enum: [...QUESTION_TYPES] }),
    optionsJson: text('options_json'),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    index('idx_cfp_elements_event_version').on(table.eventId, table.versionId),
    uniqueIndex('cfp_elements_version_page_position').on(
      table.versionId,
      table.pageId,
      table.position,
    ),
    uniqueIndex('cfp_elements_version_field_key').on(table.versionId, table.fieldKey),
    foreignKey({
      columns: [table.eventId, table.versionId],
      foreignColumns: [cfpFormVersions.eventId, cfpFormVersions.id],
    }),
    foreignKey({
      columns: [table.eventId, table.pageId],
      foreignColumns: [cfpPages.eventId, cfpPages.id],
    }),
  ],
)

export const cfpConditionRules = sqliteTable(
  'cfp_condition_rules',
  {
    eventId: text('event_id').notNull(),
    id: text('id').notNull(),
    ruleId: text('rule_id').notNull(),
    versionId: text('version_id').notNull(),
    elementId: text('element_id').notNull(),
    groupIndex: integer('group_index').notNull(),
    conditionIndex: integer('condition_index').notNull(),
    operator: text('operator', { enum: [...CONDITION_OPERATORS] }).notNull(),
    operandKey: text('operand_key').notNull(),
    valueJson: text('value_json'),
    effect: text('effect', { enum: [...CONDITION_EFFECTS] }).notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    index('idx_cfp_condition_rules_event_version').on(table.eventId, table.versionId),
    uniqueIndex('cfp_condition_rules_group').on(
      table.versionId,
      table.elementId,
      table.groupIndex,
      table.conditionIndex,
    ),
    foreignKey({
      columns: [table.eventId, table.versionId],
      foreignColumns: [cfpFormVersions.eventId, cfpFormVersions.id],
    }),
    foreignKey({
      columns: [table.eventId, table.elementId],
      foreignColumns: [cfpElements.eventId, cfpElements.id],
    }),
  ],
)

export const cfpRoutingRules = sqliteTable(
  'cfp_routing_rules',
  {
    eventId: text('event_id').notNull(),
    id: text('id').notNull(),
    versionId: text('version_id').notNull(),
    position: integer('position').notNull(),
    conditionJson: text('condition_json').notNull(),
    actionKind: text('action_kind', { enum: [...ROUTING_ACTIONS] }).notNull(),
    actionTarget: text('action_target'),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    index('idx_cfp_routing_rules_event_version').on(table.eventId, table.versionId),
    uniqueIndex('cfp_routing_rules_version_position').on(table.versionId, table.position),
    foreignKey({
      columns: [table.eventId, table.versionId],
      foreignColumns: [cfpFormVersions.eventId, cfpFormVersions.id],
    }),
  ],
)

export const proposalDrafts = sqliteTable(
  'proposal_drafts',
  {
    id: text('id').notNull(),
    eventId: text('event_id').notNull(),
    ownerContactId: text('owner_contact_id').notNull(),
    formVersionId: text('form_version_id').notNull(),
    title: text('title').notNull(),
    answersJson: text('answers_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    uniqueIndex('idx_proposal_drafts_id').on(table.id),
    index('idx_drafts_event_owner').on(table.eventId, table.ownerContactId),
    foreignKey({
      columns: [table.eventId, table.formVersionId],
      foreignColumns: [cfpFormVersions.eventId, cfpFormVersions.id],
    }),
    foreignKey({
      columns: [table.ownerContactId],
      foreignColumns: [contacts.id],
    }),
  ],
)

export const proposalSubmissions = sqliteTable(
  'proposal_submissions',
  {
    id: text('id').notNull(),
    eventId: text('event_id').notNull(),
    ownerContactId: text('owner_contact_id').notNull(),
    formVersionId: text('form_version_id').notNull(),
    originDraftId: text('origin_draft_id').notNull().unique(),
    status: text('status', { enum: [...SUBMISSION_STATUSES] }).notNull(),
    title: text('title').notNull(),
    answersJson: text('answers_json').notNull(),
    contentHash: text('content_hash').notNull(),
    routingJson: text('routing_json'),
    createdAt: text('created_at').notNull(),
    submittedAt: text('submitted_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    uniqueIndex('idx_proposal_submissions_id').on(table.id),
    index('idx_submissions_event_version_owner').on(
      table.eventId,
      table.formVersionId,
      table.ownerContactId,
    ),
    foreignKey({
      columns: [table.eventId, table.formVersionId],
      foreignColumns: [cfpFormVersions.eventId, cfpFormVersions.id],
    }),
    foreignKey({
      columns: [table.ownerContactId],
      foreignColumns: [contacts.id],
    }),
  ],
)

export const submissionContributors = sqliteTable(
  'submission_contributors',
  {
    eventId: text('event_id').notNull(),
    submissionId: text('submission_id').notNull(),
    contactId: text('contact_id').notNull(),
    role: text('role', { enum: [...CONTACT_ROLES] }).notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    index('idx_contributors_event_submission').on(table.eventId, table.submissionId),
    uniqueIndex('submission_contributors_submission_contact').on(
      table.submissionId,
      table.contactId,
    ),
    foreignKey({
      columns: [table.eventId, table.submissionId],
      foreignColumns: [proposalSubmissions.eventId, proposalSubmissions.id],
    }),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contacts.id],
    }),
  ],
)

export const capturedMessages = sqliteTable(
  'captured_messages',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_captured_messages_email').on(table.toEmail),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [events.id],
    }),
  ],
)

export const confirmationRecords = sqliteTable(
  'confirmation_records',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    submissionId: text('submission_id').notNull().unique(),
    capturedMessageId: text('captured_message_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.submissionId],
      foreignColumns: [proposalSubmissions.eventId, proposalSubmissions.id],
    }),
    foreignKey({
      columns: [table.capturedMessageId],
      foreignColumns: [capturedMessages.id],
    }),
  ],
)

/**
 * Agenda (0006) mirror. Enum values inline from the agenda domain types
 * (`src/domain/agenda.ts`): AgendaSessionStatus ('draft' | 'published') and
 * AgendaSessionAssignment ('unassigned' | 'scheduled'); the migration's
 * CHECKs (day format, UTC-instant lengths, end > start, assignment/position
 * coupling) are SQL-side only, matching the repo convention.
 */
export const agendaSessions = sqliteTable(
  'agenda_sessions',
  {
    eventId: text('event_id').notNull(),
    submissionId: text('submission_id').notNull(),
    trackId: text('track_id'),
    roomId: text('room_id'),
    day: text('day').notNull(),
    start: text('start').notNull(),
    end: text('end').notNull(),
    position: integer('position'),
    status: text('status', { enum: ['draft', 'published'] }).notNull(),
    assignment: text('assignment', { enum: ['unassigned', 'scheduled'] }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.submissionId] }),
    uniqueIndex('agenda_sessions_submission_id').on(table.submissionId),
    uniqueIndex('agenda_sessions_room_slot_position').on(
      table.eventId,
      table.roomId,
      table.day,
      table.start,
      table.end,
      table.position,
    ),
    index('idx_agenda_sessions_event_day').on(table.eventId, table.day),
    foreignKey({
      columns: [table.eventId, table.submissionId],
      foreignColumns: [proposalSubmissions.eventId, proposalSubmissions.id],
    }),
    foreignKey({
      columns: [table.eventId, table.trackId],
      foreignColumns: [taxonomyItems.eventId, taxonomyItems.id],
    }),
    foreignKey({
      columns: [table.eventId, table.roomId],
      foreignColumns: [taxonomyItems.eventId, taxonomyItems.id],
    }),
  ],
)

export const agendaSessionSpeakers = sqliteTable(
  'agenda_session_speakers',
  {
    eventId: text('event_id').notNull(),
    submissionId: text('submission_id').notNull(),
    contactId: text('contact_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.submissionId, table.contactId] }),
    uniqueIndex('agenda_session_speakers_submission_contact').on(
      table.submissionId,
      table.contactId,
    ),
    index('idx_agenda_session_speakers_event_submission').on(table.eventId, table.submissionId),
    foreignKey({
      columns: [table.eventId, table.submissionId],
      foreignColumns: [agendaSessions.eventId, agendaSessions.submissionId],
    }),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contacts.id],
    }),
  ],
)

/**
 * Onboarding (0007) mirror. Acceptance is a row, not a submission-status
 * mutation, and every speaker task hangs off it via a composite FK. Enum
 * values come from the speaker-task domain (`src/domain/speaker-task.ts`);
 * the migration's CHECKs (instant lengths, status/completed_at coupling,
 * completed_at >= created_at) are SQL-side only, matching the repo convention.
 */
export const submissionAcceptances = sqliteTable(
  'submission_acceptances',
  {
    eventId: text('event_id').notNull(),
    submissionId: text('submission_id').notNull(),
    acceptedAt: text('accepted_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.submissionId] }),
    uniqueIndex('submission_acceptances_submission_id').on(table.submissionId),
    foreignKey({
      columns: [table.eventId, table.submissionId],
      foreignColumns: [proposalSubmissions.eventId, proposalSubmissions.id],
    }),
  ],
)

export const speakerTasks = sqliteTable(
  'speaker_tasks',
  {
    eventId: text('event_id').notNull(),
    id: text('id').notNull(),
    submissionId: text('submission_id').notNull(),
    contactId: text('contact_id').notNull(),
    kind: text('kind', { enum: [...SPEAKER_TASK_KINDS] }).notNull(),
    status: text('status', { enum: [...SPEAKER_TASK_STATUSES] }).notNull(),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    uniqueIndex('idx_speaker_tasks_id').on(table.id),
    uniqueIndex('speaker_tasks_submission_contact_kind').on(
      table.submissionId,
      table.contactId,
      table.kind,
    ),
    index('idx_speaker_tasks_event_contact').on(table.eventId, table.contactId),
    index('idx_speaker_tasks_event_submission').on(table.eventId, table.submissionId),
    foreignKey({
      columns: [table.eventId, table.submissionId],
      foreignColumns: [submissionAcceptances.eventId, submissionAcceptances.submissionId],
    }),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contacts.id],
    }),
  ],
)

export type EventRow = typeof events.$inferSelect
export type ContactRow = typeof contacts.$inferSelect
export type SubmitterTokenRow = typeof submitterTokens.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type TaxonomyItemRow = typeof taxonomyItems.$inferSelect
export type CfpFormRow = typeof cfpForms.$inferSelect
export type CfpFormVersionRow = typeof cfpFormVersions.$inferSelect
export type CfpPageRow = typeof cfpPages.$inferSelect
export type CfpElementRow = typeof cfpElements.$inferSelect
export type CfpConditionRuleRow = typeof cfpConditionRules.$inferSelect
export type CfpRoutingRuleRow = typeof cfpRoutingRules.$inferSelect
export type ProposalDraftRow = typeof proposalDrafts.$inferSelect
export type ProposalSubmissionRow = typeof proposalSubmissions.$inferSelect
export type SubmissionContributorRow = typeof submissionContributors.$inferSelect
export type CapturedMessageRow = typeof capturedMessages.$inferSelect
export type ConfirmationRecordRow = typeof confirmationRecords.$inferSelect
export type AgendaSessionRow = typeof agendaSessions.$inferSelect
export type AgendaSessionSpeakerRow = typeof agendaSessionSpeakers.$inferSelect
export type SubmissionAcceptanceRow = typeof submissionAcceptances.$inferSelect
export type SpeakerTaskRow = typeof speakerTasks.$inferSelect

/** Drizzle mirror of migrations/0008_create_uploaded_files_table.sql. */
export const uploadedFiles = sqliteTable(
  'uploaded_files',
  {
    id: text('id').notNull(),
    eventId: text('event_id').notNull(),
    ownerContactId: text('owner_contact_id').notNull(),
    kind: text('kind', { enum: [...UPLOADED_FILE_KINDS] }).notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.id] }),
    uniqueIndex('idx_uploaded_files_id').on(table.id),
    uniqueIndex('uploaded_files_storage_key').on(table.storageKey),
    uniqueIndex('uploaded_files_event_owner_kind').on(
      table.eventId,
      table.ownerContactId,
      table.kind,
    ),
    index('idx_uploaded_files_event_owner').on(table.eventId, table.ownerContactId),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [events.id],
    }),
    foreignKey({
      columns: [table.ownerContactId],
      foreignColumns: [contacts.id],
    }),
  ],
)

export type UploadedFileRow = typeof uploadedFiles.$inferSelect
