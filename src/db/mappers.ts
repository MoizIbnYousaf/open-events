import type {
  AnswerMap,
  AnswerValue,
  CapturedMessage,
  CfpForm,
  ConditionGroup,
  ConditionOperator,
  ConditionSet,
  ConditionValue,
  ConfirmationRecord,
  Contact,
  DecodedSessionRow,
  ElementCondition,
  ElementRule,
  Event,
  FormElement,
  FormPage,
  FormVersion,
  ProposalDraft,
  ProposalSubmission,
  RoutingOutcome,
  RoutingRule,
  Session,
  SubmissionContributor,
  SubmitterToken,
  TaxonomyItem,
} from '../domain'
import { validateSessionIdentity } from '../domain/auth'
import type {
  CapturedMessageRow,
  CfpConditionRuleRow,
  CfpElementRow,
  CfpFormRow,
  CfpFormVersionRow,
  CfpPageRow,
  CfpRoutingRuleRow,
  ConfirmationRecordRow,
  ContactRow,
  EventRow,
  ProposalDraftRow,
  ProposalSubmissionRow,
  SessionRow,
  SubmissionContributorRow,
  SubmitterTokenRow,
  TaxonomyItemRow,
} from './schema'

/** Thrown when a persisted row cannot be decoded into the domain contract. */
export class DbDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DbDecodeError'
  }
}

export function toEvent(row: EventRow): Event {
  const asset = (kind: 'logo' | 'background'): NonNullable<Event['branding']>['logo'] => {
    const values =
      kind === 'logo'
        ? [
            row.logoStorageKey,
            row.logoContentType,
            row.logoWidth,
            row.logoHeight,
            row.logoUpdatedAt,
          ]
        : [
            row.backgroundStorageKey,
            row.backgroundContentType,
            row.backgroundWidth,
            row.backgroundHeight,
            row.backgroundUpdatedAt,
          ]
    const missing = (value: unknown): boolean => value === null || value === undefined
    if (values.every(missing)) return null
    if (values.some(missing)) {
      throw new DbDecodeError(`Event ${kind} branding metadata is incomplete`)
    }
    return {
      storageKey: values[0] as string,
      contentType: values[1] as string,
      width: values[2] as number,
      height: values[3] as number,
      updatedAt: values[4] as string,
    }
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    status: row.status,
    dates:
      row.startsAt !== null && row.endsAt !== null
        ? { startsAt: row.startsAt, endsAt: row.endsAt }
        : null,
    websiteUrl: row.websiteUrl ?? null,
    organizerContact: row.organizerContact ?? null,
    venue: row.venue ?? null,
    eventType: row.eventType ?? null,
    branding: { logo: asset('logo'), background: asset('background') },
  }
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt,
    bio: row.bio,
  }
}

export function toSubmitterToken(row: SubmitterTokenRow): SubmitterToken {
  if ((row.purpose === 'cfp' || row.purpose === null) && row.formId === null) {
    throw new DbDecodeError('CFP or legacy submitter token row is missing form_id')
  }
  return {
    id: row.id,
    contactId: row.contactId,
    eventId: row.eventId,
    formId: row.formId,
    purpose: row.purpose,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  }
}

export function toSession(row: SessionRow): Session {
  const decoded: DecodedSessionRow = {
    id: row.id,
    kind: row.kind,
    contactId: row.contactId,
    eventId: row.eventId ?? undefined,
    capability: row.capability,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
    provenance: row.provenance,
  }
  const issues = validateSessionIdentity(decoded)
  if (issues.length > 0) {
    const issue = issues[0]
    throw new DbDecodeError(issue === undefined ? 'invalid session row' : issue.message)
  }
  if (row.kind === 'submitter' && row.contactId !== null && row.eventId !== null) {
    return {
      id: row.id,
      kind: 'submitter',
      contactId: row.contactId,
      eventId: row.eventId,
      capability: row.capability,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      createdAt: row.createdAt,
      provenance: row.provenance,
    }
  }
  return {
    id: row.id,
    kind: 'organizer',
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
    provenance: row.provenance,
  }
}

export function toCapturedMessage(row: CapturedMessageRow): CapturedMessage {
  return {
    id: row.id,
    eventId: row.eventId,
    toEmail: row.toEmail,
    subject: row.subject,
    body: row.body,
    createdAt: row.createdAt,
    kind: row.kind,
    submissionId: row.submissionId,
  }
}

export function toConfirmationRecord(row: ConfirmationRecordRow): ConfirmationRecord {
  return {
    id: row.id,
    eventId: row.eventId,
    submissionId: row.submissionId,
    capturedMessageId: row.capturedMessageId,
    createdAt: row.createdAt,
  }
}

export function toProposalDraft(row: ProposalDraftRow): ProposalDraft {
  return {
    id: row.id,
    eventId: row.eventId,
    ownerContactId: row.ownerContactId,
    formVersionId: row.formVersionId,
    title: row.title,
    answers: parseAnswerMap(row.answersJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function toProposalSubmission(row: ProposalSubmissionRow): ProposalSubmission {
  return {
    id: row.id,
    eventId: row.eventId,
    ownerContactId: row.ownerContactId,
    formVersionId: row.formVersionId,
    originDraftId: row.originDraftId,
    status: row.status,
    title: row.title,
    answers: parseAnswerMap(row.answersJson),
    contentHash: row.contentHash,
    routing: parseRoutingOutcome(row.routingJson),
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
  }
}

/** Raw snake_case row shape returned by the submit batch's same-batch read. */
export interface RawProposalSubmissionRow {
  readonly id: string
  readonly event_id: string
  readonly owner_contact_id: string
  readonly form_version_id: string
  readonly origin_draft_id: string
  readonly status: string
  readonly title: string
  readonly answers_json: string
  readonly content_hash: string
  readonly routing_json: string | null
  readonly created_at: string
  readonly submitted_at: string
}

/** Maps a raw snake_case D1 row into the domain contract (camelCase fields). */
export function toProposalSubmissionFromRaw(row: RawProposalSubmissionRow): ProposalSubmission {
  if (row.status !== 'pending') {
    throw new DbDecodeError(`submission row carries unknown status '${row.status}'`)
  }
  return {
    id: row.id,
    eventId: row.event_id,
    ownerContactId: row.owner_contact_id,
    formVersionId: row.form_version_id,
    originDraftId: row.origin_draft_id,
    status: 'pending',
    title: row.title,
    answers: parseAnswerMap(row.answers_json),
    contentHash: row.content_hash,
    routing: parseRoutingOutcome(row.routing_json),
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
  }
}

export function toSubmissionContributor(row: SubmissionContributorRow): SubmissionContributor {
  return {
    submissionId: row.submissionId,
    eventId: row.eventId,
    contactId: row.contactId,
    role: row.role,
    position: row.position,
  }
}

export function toTaxonomyItem(row: TaxonomyItemRow): TaxonomyItem {
  return {
    id: row.id,
    eventId: row.eventId,
    kind: row.kind,
    key: row.key,
    label: row.label,
    position: row.position,
  }
}

export function toCfpForm(row: CfpFormRow): CfpForm {
  return {
    id: row.id,
    eventId: row.eventId,
    slug: row.slug,
    status: row.status,
    publishedVersionId: row.publishedVersionId,
    limits: {
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      totalCap: row.totalCap,
      perIdentityLimit: row.perIdentityLimit,
    },
  }
}

export function toFormVersion(row: CfpFormVersionRow): FormVersion {
  return {
    id: row.id,
    eventId: row.eventId,
    formId: row.formId,
    version: row.version,
    status: row.status,
    contentHash: row.contentHash,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  }
}

export function toFormPage(row: CfpPageRow): FormPage {
  return {
    id: row.id,
    eventId: row.eventId,
    versionId: row.versionId,
    position: row.position,
    kind: row.kind,
    title: row.title,
    content: row.content,
  }
}

export function toFormElement(row: CfpElementRow): FormElement {
  return {
    id: row.id,
    eventId: row.eventId,
    versionId: row.versionId,
    pageId: row.pageId,
    position: row.position,
    kind: row.kind,
    fieldKey: row.fieldKey,
    label: row.label,
    required: row.required === 1,
    maxLength: row.maxLength,
    questionType: row.questionType,
    options: parseStringArray(row.optionsJson),
    // Carried, never resolved here. This function is a pure row-to-domain
    // mapping with no repository behind it, and resolving a taxonomy needs one.
    optionsSource: row.optionsSource ?? null,
  }
}

/**
 * Groups per-condition rows into domain ElementRules. A rule's id is shared by
 * every condition row (rule_id); group/condition indexes preserve ordering.
 */
export function toElementRules(rows: readonly CfpConditionRuleRow[]): readonly ElementRule[] {
  const byRule = new Map<string, CfpConditionRuleRow[]>()
  for (const row of rows) {
    const group = byRule.get(row.ruleId)
    if (group === undefined) {
      byRule.set(row.ruleId, [row])
    } else {
      group.push(row)
    }
  }
  const rules: ElementRule[] = []
  for (const [ruleId, ruleRows] of byRule) {
    const first = ruleRows[0]
    if (first === undefined) continue
    const conditionsByGroup = new Map<number, ElementCondition[]>()
    for (const row of ruleRows) {
      const conditions = conditionsByGroup.get(row.groupIndex) ?? []
      conditions.push({
        operator: row.operator,
        operandKey: row.operandKey,
        value: row.valueJson === null ? null : parseConditionValue(row.valueJson),
      })
      conditionsByGroup.set(row.groupIndex, conditions)
    }
    const groupIndexes = [...conditionsByGroup.keys()].sort((a, b) => a - b)
    rules.push({
      id: ruleId,
      eventId: first.eventId,
      versionId: first.versionId,
      elementId: first.elementId,
      effect: first.effect,
      position: first.position,
      groups: groupIndexes.map((groupIndex) => ({
        groupIndex,
        conditions: conditionsByGroup.get(groupIndex) ?? [],
      })),
    })
  }
  return rules.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}

export function toRoutingRule(row: CfpRoutingRuleRow): RoutingRule {
  return {
    id: row.id,
    eventId: row.eventId,
    versionId: row.versionId,
    position: row.position,
    condition: parseConditionSet(row.conditionJson),
    actionKind: row.actionKind,
    actionTarget: row.actionTarget,
  }
}

function parseAnswerMap(json: string): AnswerMap {
  const parsed: unknown = JSON.parse(json)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DbDecodeError('answers_json must decode to an object')
  }
  const answers: Record<string, AnswerValue | null> = {}
  for (const [key, value] of Object.entries(parsed)) {
    answers[key] = parseAnswerValue(value)
  }
  return answers
}

function parseAnswerValue(value: unknown): AnswerValue | null {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }
  throw new DbDecodeError('answer value has an unsupported type')
}

function parseStringArray(json: string | null): readonly string[] {
  if (json === null) return []
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new DbDecodeError('options_json must decode to a string array')
  }
  return parsed
}

function parseConditionValue(json: string): ConditionValue {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
    return parsed
  }
  throw new DbDecodeError('value_json must decode to a scalar condition value')
}

function parseConditionSet(json: string): ConditionSet {
  const parsed: unknown = JSON.parse(json)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DbDecodeError('condition_json must decode to an object')
  }
  const rawGroups = (parsed as { groups?: unknown }).groups
  if (!Array.isArray(rawGroups)) {
    throw new DbDecodeError('condition_json must contain a groups array')
  }
  const groups: ConditionGroup[] = rawGroups.map(parseConditionGroup)
  return { groups }
}

function parseConditionGroup(value: unknown): ConditionGroup {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DbDecodeError('condition group must be an object')
  }
  const rawConditions = (value as { conditions?: unknown }).conditions
  if (!Array.isArray(rawConditions)) {
    throw new DbDecodeError('condition group must contain a conditions array')
  }
  return { conditions: rawConditions.map(parseElementCondition) }
}

function parseElementCondition(value: unknown): ElementCondition {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DbDecodeError('condition must be an object')
  }
  const record = value as {
    operator?: unknown
    operandKey?: unknown
    value?: unknown
  }
  if (typeof record.operator !== 'string' || typeof record.operandKey !== 'string') {
    throw new DbDecodeError('condition must carry operator and operandKey strings')
  }
  const operator = record.operator as ConditionOperator
  const validOperators: readonly ConditionOperator[] = [
    'eq',
    'ne',
    'contains',
    'gt',
    'lt',
    'empty',
    'not-empty',
  ]
  if (!validOperators.includes(operator)) {
    throw new DbDecodeError(`unknown condition operator '${operator}'`)
  }
  const conditionValue =
    record.value === null || record.value === undefined
      ? null
      : parseConditionValue(JSON.stringify(record.value))
  return { operator, operandKey: record.operandKey, value: conditionValue }
}

function parseRoutingOutcome(json: string | null): RoutingOutcome | null {
  if (json === null) return null
  const parsed: unknown = JSON.parse(json)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DbDecodeError('routing_json must decode to an object or null')
  }
  const record = parsed as { actionKind?: unknown; actionTarget?: unknown }
  if (
    record.actionKind !== 'assign_track' &&
    record.actionKind !== 'assign_tag' &&
    record.actionKind !== 'manual_review'
  ) {
    throw new DbDecodeError('routing_json carries an unknown action kind')
  }
  return {
    actionKind: record.actionKind,
    actionTarget: record.actionTarget === undefined ? null : (record.actionTarget as string | null),
  }
}
