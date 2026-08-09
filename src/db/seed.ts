import type {
  CfpForm,
  ElementRule,
  Event,
  FormElement,
  FormPage,
  FormVersion,
  FormVersionContent,
  RoutingRule,
  TaxonomyItem,
} from '../domain'

/** Stable deterministic UUID v4 used by the DemoConf 2026 seed row. */
export const DEMO_CONF_2026_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'

/** Deterministic DemoConf 2026 seed data; mirrors `src/db/seed.sql`. */
export const demoConf2026Seed: Event = {
  id: DEMO_CONF_2026_ID,
  slug: 'demo-conf-2026',
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  dates: {
    startsAt: '2026-05-13T08:00:00.000Z',
    endsAt: '2026-05-15T17:00:00.000Z',
  },
  websiteUrl: 'https://example.test/demo-conf-2026',
  organizerContact: 'programme@example.test',
  venue: 'DemoConf Convention Center, Berlin',
  eventType: 'conference',
}

export const DEMO_CONF_2026_FORM_ID = 'f0000000-0000-4000-8000-000000000001'
export const DEMO_CONF_2026_VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
export const DEMO_CONF_2026_CONTENT_HASH =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
export const DEMO_CONF_2026_PUBLISHED_AT = '2026-01-01T09:00:00.000Z'

export const demoConf2026Form: CfpForm = {
  id: DEMO_CONF_2026_FORM_ID,
  eventId: DEMO_CONF_2026_ID,
  slug: 'cfp',
  status: 'published',
  publishedVersionId: DEMO_CONF_2026_VERSION_ID,
  limits: {
    opensAt: '2026-01-01T00:00:00.000Z',
    closesAt: '2026-12-31T23:59:59.000Z',
    totalCap: 100,
    perIdentityLimit: 1,
  },
}

export const demoConf2026PublishedVersion: FormVersion = {
  id: DEMO_CONF_2026_VERSION_ID,
  eventId: DEMO_CONF_2026_ID,
  formId: DEMO_CONF_2026_FORM_ID,
  version: 1,
  status: 'published',
  contentHash: DEMO_CONF_2026_CONTENT_HASH,
  publishedAt: DEMO_CONF_2026_PUBLISHED_AT,
  updatedAt: DEMO_CONF_2026_PUBLISHED_AT,
}

const page = (
  id: string,
  position: number,
  kind: FormPage['kind'],
  title: string,
  content: string,
): FormPage => ({
  id,
  eventId: DEMO_CONF_2026_ID,
  versionId: DEMO_CONF_2026_VERSION_ID,
  position,
  kind,
  title,
  content,
})

const welcomePage = page(
  'f0000000-0000-4000-8000-000000000100',
  0,
  'welcome',
  'Welcome',
  'Welcome to the DemoConf 2026 call for papers.',
)
const proposalPage = page(
  'f0000000-0000-4000-8000-000000000101',
  1,
  'info',
  'Proposal information',
  'Tell us about your session.',
)
const participantPage = page(
  'f0000000-0000-4000-8000-000000000102',
  2,
  'info',
  'Participant information',
  'Help us plan the programme.',
)
const reviewPage = page(
  'f0000000-0000-4000-8000-000000000103',
  3,
  'submit',
  'Review and submit',
  'Review your answers and submit.',
)

const formatElement: FormElement = {
  id: 'f0000000-0000-4000-8000-000000000201',
  eventId: DEMO_CONF_2026_ID,
  versionId: DEMO_CONF_2026_VERSION_ID,
  pageId: proposalPage.id,
  position: 0,
  kind: 'question',
  fieldKey: 'format',
  label: 'Session format',
  required: true,
  maxLength: null,
  questionType: 'single_choice',
  options: ['workshop', 'talk'],
}

const workshopElement: FormElement = {
  id: 'f0000000-0000-4000-8000-000000000202',
  eventId: DEMO_CONF_2026_ID,
  versionId: DEMO_CONF_2026_VERSION_ID,
  pageId: proposalPage.id,
  position: 1,
  kind: 'question',
  fieldKey: 'workshop_details',
  label: 'Workshop details',
  required: true,
  maxLength: 2000,
  questionType: 'long_text',
  options: [],
}

const workshopConditionRule: ElementRule = {
  id: 'f0000000-0000-4000-8000-000000000301',
  eventId: DEMO_CONF_2026_ID,
  versionId: DEMO_CONF_2026_VERSION_ID,
  elementId: workshopElement.id,
  effect: 'show',
  position: 0,
  groups: [
    {
      groupIndex: 0,
      conditions: [{ operator: 'eq', operandKey: 'format', value: 'workshop' }],
    },
  ],
}

const workshopRoutingRule: RoutingRule = {
  id: 'f0000000-0000-4000-8000-000000000401',
  eventId: DEMO_CONF_2026_ID,
  versionId: DEMO_CONF_2026_VERSION_ID,
  position: 0,
  condition: {
    groups: [
      {
        conditions: [{ operator: 'eq', operandKey: 'format', value: 'workshop' }],
      },
    ],
  },
  actionKind: 'assign_track',
  actionTarget: 'workshop',
}

/** Seeded 4-page CFP content for the published DemoConf 2026 version. */
export const demoConf2026Content: FormVersionContent = {
  pages: [welcomePage, proposalPage, participantPage, reviewPage],
  elements: [formatElement, workshopElement],
  conditionRules: [workshopConditionRule],
  routingRules: [workshopRoutingRule],
}

export const demoConf2026Taxonomy: readonly TaxonomyItem[] = [
  {
    id: 'f0000000-0000-4000-8000-000000000501',
    eventId: DEMO_CONF_2026_ID,
    kind: 'format',
    key: 'workshop',
    label: 'Workshop',
    position: 0,
  },
  {
    id: 'f0000000-0000-4000-8000-000000000502',
    eventId: DEMO_CONF_2026_ID,
    kind: 'format',
    key: 'talk',
    label: 'Talk',
    position: 1,
  },
  {
    id: 'f0000000-0000-4000-8000-000000000505',
    eventId: DEMO_CONF_2026_ID,
    kind: 'room',
    key: 'main-hall',
    label: 'Main hall',
    position: 0,
  },
  {
    id: 'f0000000-0000-4000-8000-000000000506',
    eventId: DEMO_CONF_2026_ID,
    kind: 'room',
    key: 'workshop-a',
    label: 'Workshop A',
    position: 1,
  },
  {
    id: 'f0000000-0000-4000-8000-000000000503',
    eventId: DEMO_CONF_2026_ID,
    kind: 'track',
    key: 'workshop',
    label: 'Workshop',
    position: 0,
  },
  {
    id: 'f0000000-0000-4000-8000-000000000504',
    eventId: DEMO_CONF_2026_ID,
    kind: 'track',
    key: 'talk',
    label: 'Talk',
    position: 1,
  },
]
