import type {
  CfpForm,
  Contact,
  DecodedSessionRow,
  ElementCondition,
  ElementRule,
  Event,
  FormElement,
  FormLimits,
  FormPage,
  FormVersion,
  FormVersionContent,
  OrganizerSession,
  ProposalDraft,
  ProposalSubmission,
  RoutingRule,
  SubmitterSession,
  SubmitterToken,
  TaxonomyItem,
} from '../../../src/domain'
import {
  toOrganizerActor,
  toSubmitterActor,
  type OrganizerActor,
  type SubmitterActor,
} from '../../../src/application'

export const EVENT_ID = 'event-demo-conf'
export const EVENT_SLUG = 'demo-conf-2026'
export const FORM_ID = 'form-cfp'
export const FORM_SLUG = 'cfp'
export const VERSION_ID = 'version-1'
export const PAGE_ID = 'page-proposal'
export const OWNER_CONTACT_ID = 'contact-speaker-a'
export const DRAFT_ID = 'draft-1'
export const NOW = '2026-05-15T00:00:00.000Z'
export const FIXED_NOW = '2026-05-20T09:00:00.000Z'

/**
 * Documented test form id for token fixtures. RR-2 will add `formId` to the
 * domain `SubmitterToken`; until that domain change lands, `createSubmitterToken`
 * returns the intersection below so fixtures already carry the field.
 */
export const TEST_FORM_ID = FORM_ID

function submitterActorFromSession(session: SubmitterSession): SubmitterActor {
  const actor = toSubmitterActor(session)
  if (actor === null) {
    throw new Error('Expected a submitter actor from a submitter session fixture')
  }
  return actor
}

function organizerActorFromSession(session: OrganizerSession): OrganizerActor {
  const actor = toOrganizerActor(session)
  if (actor === null) {
    throw new Error('Expected an organizer actor from an organizer session fixture')
  }
  return actor
}

export const ownerActor: SubmitterActor = submitterActorFromSession(createSubmitterSession())

export const foreignActor: SubmitterActor = submitterActorFromSession(
  createSubmitterSession({ contactId: 'contact-other' }),
)

export const crossEventActor: SubmitterActor = submitterActorFromSession(
  createSubmitterSession({ eventId: 'event-other' }),
)

export const organizerActor: OrganizerActor = organizerActorFromSession(createOrganizerSession())

/** Actor fixture derived from a submitter session (session-override form). */
export function createSubmitterActor(overrides: Partial<SubmitterSession> = {}): SubmitterActor {
  return submitterActorFromSession(createSubmitterSession(overrides))
}

export function createOrganizerSession(
  overrides: Partial<OrganizerSession> = {},
): OrganizerSession {
  return {
    id: 'session-org-1',
    kind: 'organizer',
    tokenHash: 'hash:org-token',
    expiresAt: '2026-06-01T00:00:00.000Z',
    consumedAt: null,
    createdAt: NOW,
    provenance: 'ordinary',
    ...overrides,
  }
}

export function createSubmitterSession(
  overrides: Partial<SubmitterSession> = {},
): SubmitterSession {
  return {
    id: 'session-sub-1',
    kind: 'submitter',
    contactId: OWNER_CONTACT_ID,
    eventId: EVENT_ID,
    capability: 'portal',
    tokenHash: 'hash:sub-token',
    expiresAt: '2026-06-01T00:00:00.000Z',
    consumedAt: null,
    createdAt: NOW,
    provenance: 'ordinary',
    ...overrides,
  }
}

export function createDecodedSessionRow(
  overrides: Partial<DecodedSessionRow> = {},
): DecodedSessionRow {
  return {
    id: 'session-row-1',
    kind: 'submitter',
    contactId: OWNER_CONTACT_ID,
    eventId: EVENT_ID,
    capability: 'portal',
    tokenHash: 'hash:row-token',
    expiresAt: '2026-05-16T00:00:00.000Z',
    consumedAt: null,
    createdAt: NOW,
    provenance: 'ordinary',
    ...overrides,
  }
}

export function createSubmitterToken(overrides: Partial<SubmitterToken> = {}): SubmitterToken {
  return {
    id: 'token-id-1',
    contactId: OWNER_CONTACT_ID,
    eventId: EVENT_ID,
    formId: TEST_FORM_ID,
    purpose: 'cfp',
    tokenHash: 'hash:token-1',
    expiresAt: '2026-06-01T00:00:00.000Z',
    consumedAt: null,
    createdAt: NOW,
    ...overrides,
  }
}

export const openLimits: FormLimits = {
  opensAt: null,
  closesAt: null,
  totalCap: null,
  perIdentityLimit: null,
}

export const eventFixture: Event = {
  id: EVENT_ID,
  slug: EVENT_SLUG,
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'published',
  dates: {
    startsAt: '2026-05-13T08:00:00.000Z',
    endsAt: '2026-05-15T17:00:00.000Z',
  },
  websiteUrl: 'https://democonf.example',
  organizerContact: 'team@example.test',
  venue: 'Berlin',
  eventType: 'conference',
}

export function createForm(overrides: Partial<CfpForm> = {}): CfpForm {
  return {
    id: FORM_ID,
    eventId: EVENT_ID,
    slug: FORM_SLUG,
    status: 'draft',
    purpose: 'public',
    publishedVersionId: null,
    limits: openLimits,
    ...overrides,
  }
}

export function createVersion(overrides: Partial<FormVersion> = {}): FormVersion {
  return {
    id: VERSION_ID,
    eventId: EVENT_ID,
    formId: FORM_ID,
    version: 1,
    status: 'draft',
    contentHash: null,
    publishedAt: null,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createPage(overrides: Partial<FormPage> = {}): FormPage {
  return {
    id: PAGE_ID,
    eventId: EVENT_ID,
    versionId: VERSION_ID,
    position: 0,
    kind: 'info',
    title: 'Proposal information',
    content: '',
    ...overrides,
  }
}

export function createElement(overrides: Partial<FormElement> = {}): FormElement {
  return {
    id: 'element-title',
    eventId: EVENT_ID,
    versionId: VERSION_ID,
    pageId: PAGE_ID,
    position: 0,
    kind: 'question',
    fieldKey: 'title',
    label: 'Proposal title',
    required: true,
    maxLength: 200,
    questionType: 'short_text',
    options: [],
    optionsSource: null,
    ...overrides,
  }
}

export const formatElement = createElement({
  id: 'element-format',
  position: 1,
  fieldKey: 'format',
  label: 'Format',
  required: true,
  maxLength: null,
  questionType: 'single_choice',
  options: ['talk', 'workshop'],
})

/** Proposal title element: the canonical required short-text field. */
export const titleElement = createElement()

export const workshopElement = createElement({
  id: 'element-workshop',
  position: 2,
  fieldKey: 'workshop',
  label: 'Workshop details',
  required: false,
  maxLength: 500,
  questionType: 'long_text',
  options: [],
})

export const emailElement = createElement({
  id: 'element-contact-email',
  position: 3,
  fieldKey: 'contact-email',
  label: 'Contact email',
  required: true,
  maxLength: null,
  questionType: 'email',
  options: [],
})

export const attendeesElement = createElement({
  id: 'element-attendees',
  position: 4,
  fieldKey: 'attendees',
  label: 'Expected attendees',
  required: false,
  maxLength: null,
  questionType: 'number',
  options: [],
})

export const topicsElement = createElement({
  id: 'element-topics',
  position: 5,
  fieldKey: 'topics',
  label: 'Topics',
  required: false,
  maxLength: null,
  questionType: 'multi_choice',
  options: ['ai', 'web', 'cloud'],
})

export function condition(overrides: Partial<ElementCondition> = {}): ElementCondition {
  return {
    operator: 'eq',
    operandKey: 'format',
    value: 'workshop',
    ...overrides,
  }
}

export const showWorkshopRule: ElementRule = {
  id: 'rule-show-workshop',
  eventId: EVENT_ID,
  versionId: VERSION_ID,
  elementId: workshopElement.id,
  effect: 'show',
  groups: [
    {
      groupIndex: 0,
      conditions: [condition()],
    },
  ],
  position: 0,
}

export const routeWorkshopRule: RoutingRule = {
  id: 'route-workshop',
  eventId: EVENT_ID,
  versionId: VERSION_ID,
  position: 0,
  condition: {
    groups: [
      {
        conditions: [condition()],
      },
    ],
  },
  actionKind: 'assign_track',
  actionTarget: 'workshop',
}

export function createContent(overrides: Partial<FormVersionContent> = {}): FormVersionContent {
  return {
    pages: [createPage()],
    elements: [
      titleElement,
      formatElement,
      workshopElement,
      emailElement,
      attendeesElement,
      topicsElement,
    ],
    conditionRules: [showWorkshopRule],
    routingRules: [routeWorkshopRule],
    ...overrides,
  }
}

export function createTaxonomyItem(overrides: Partial<TaxonomyItem> = {}): TaxonomyItem {
  return {
    id: 'tax-workshop',
    eventId: EVENT_ID,
    kind: 'track',
    key: 'workshop',
    label: 'Workshop',
    position: 0,
    ...overrides,
  }
}

export const ownerContact: Contact = {
  id: OWNER_CONTACT_ID,
  email: 'speaker-a@example.test',
  name: 'Speaker A',
  createdAt: NOW,
}

export function startMailBudgetFixture(
  suffix = 'one',
  now = FIXED_NOW,
): import('../../../src/application').StartMailBudgetReservation {
  return {
    operationId: `budget-${suffix}`,
    recipientKey: `v1:start-recipient:${'a'.repeat(63)}${suffix.length % 10}`,
    environmentKey: `v1:mail-environment:${'b'.repeat(64)}`,
    now,
  }
}

export function createDraft(overrides: Partial<ProposalDraft> = {}): ProposalDraft {
  return {
    id: DRAFT_ID,
    eventId: EVENT_ID,
    ownerContactId: OWNER_CONTACT_ID,
    formVersionId: VERSION_ID,
    title: 'Draft workshop proposal',
    answers: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createSubmission(overrides: Partial<ProposalSubmission> = {}): ProposalSubmission {
  return {
    id: 'submission-1',
    eventId: EVENT_ID,
    ownerContactId: OWNER_CONTACT_ID,
    formVersionId: VERSION_ID,
    originDraftId: DRAFT_ID,
    status: 'pending',
    source: 'cfp',
    title: 'Workshop proposal',
    answers: { format: 'workshop', title: 'Workshop proposal' },
    contentHash: 'a'.repeat(64),
    routing: { actionKind: 'assign_track', actionTarget: 'workshop' },
    createdAt: NOW,
    submittedAt: NOW,
    ...overrides,
  }
}
