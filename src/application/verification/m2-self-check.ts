/**
 * Pure-TS self-check for the frozen M2 domain contract.
 *
 * Run with:
 *   node --experimental-strip-types src/application/verification/m2-self-check.ts
 *
 * This is a deterministic smoke check over the domain invariants; it is not
 * part of the test suite.
 */
import type { AnswerMap } from '../../domain/answers.ts'
import type { FormLimits } from '../../domain/form.ts'
import type {
  FormElement,
  FormPage,
  FormVersion,
  FormVersionContent,
} from '../../domain/form-version.ts'
import type { ElementRule, RoutingRule } from '../../domain/rules.ts'
import type { TaxonomyKind } from '../../domain/taxonomy.ts'
import {
  evaluateFormSubmitGate,
  evaluateSubmitGate,
  isFormAcceptingVersion,
} from '../../domain/invariants/cfp.ts'
import {
  computeFormVersionContentHash,
  computeSubmissionContentHash,
} from '../../domain/invariants/content-hash.ts'
import {
  isNormalizedEmail,
  isValidEmailAddress,
  normalizeEmail,
} from '../../domain/invariants/email.ts'
import { validateVersionFreeze } from '../../domain/invariants/freeze.ts'
import { detectRuleCycles, validateVersionRules } from '../../domain/invariants/rules.ts'
import { isValidUtcInstant } from '../../domain/invariants/time.ts'
import { isValidTtl, MAX_SUBMITTER_TOKEN_TTL_MS } from '../../application/security/token-policy.ts'
import { addMillis } from '../../application/time.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`M2 self-check failed: ${message}`)
}

const eventId = 'event-1'
const versionId = 'version-1'

const page: FormPage = {
  id: 'page-1',
  eventId,
  versionId,
  position: 1,
  kind: 'info',
  title: 'Proposal',
  content: '',
}

const formatElement: FormElement = {
  id: 'element-format',
  eventId,
  versionId,
  pageId: page.id,
  position: 1,
  kind: 'question',
  fieldKey: 'format',
  label: 'Format',
  required: true,
  maxLength: null,
  questionType: 'single_choice',
  options: ['talk', 'workshop'],
}

const workshopElement: FormElement = {
  id: 'element-workshop',
  eventId,
  versionId,
  pageId: page.id,
  position: 2,
  kind: 'question',
  fieldKey: 'workshop',
  label: 'Workshop details',
  required: false,
  maxLength: 500,
  questionType: 'long_text',
  options: [],
}

const content: FormVersionContent = {
  pages: [page],
  elements: [formatElement, workshopElement],
  conditionRules: [
    {
      id: 'rule-a',
      eventId,
      versionId,
      elementId: workshopElement.id,
      effect: 'show',
      groups: [
        {
          groupIndex: 1,
          conditions: [{ operator: 'eq', operandKey: 'format', value: 'workshop' }],
        },
      ],
      position: 1,
    },
    {
      id: 'rule-b',
      eventId,
      versionId,
      elementId: formatElement.id,
      effect: 'show',
      groups: [
        { groupIndex: 1, conditions: [{ operator: 'eq', operandKey: 'workshop', value: 'yes' }] },
      ],
      position: 2,
    },
  ],
  routingRules: [],
}

async function main(): Promise<void> {
  // Email normalization invariant
  assert(
    normalizeEmail('  Speaker.A@Example.TEST ') === 'speaker.a@example.test',
    'email normalization',
  )
  assert(isNormalizedEmail('speaker.a@example.test'), 'normalized email recognized')
  assert(!isNormalizedEmail(' Speaker.A@example.test '), 'un-normalized email rejected')
  assert(isValidEmailAddress('speaker-a@example.test'), 'valid email accepted')

  // CFP open/cap/per-identity boundary predicates
  const limits: FormLimits = {
    opensAt: '2026-05-01T00:00:00.000Z',
    closesAt: '2026-06-01T00:00:00.000Z',
    totalCap: 2,
    perIdentityLimit: 1,
  }
  assert(
    evaluateSubmitGate(limits, '2026-04-30T23:59:59.000Z', 0, 0).reason === 'not_open_yet',
    'not open yet',
  )
  assert(evaluateSubmitGate(limits, '2026-05-15T00:00:00.000Z', 0, 0).allowed, 'CFP open')
  assert(
    evaluateSubmitGate(limits, '2026-06-01T00:00:00.000Z', 0, 0).reason === 'closed',
    'closed at closes_at',
  )
  assert(
    evaluateSubmitGate(limits, '2026-05-15T00:00:00.000Z', 2, 0).reason === 'total_cap_reached',
    'total cap',
  )
  assert(
    evaluateSubmitGate(limits, '2026-05-15T00:00:00.000Z', 1, 1).reason ===
      'identity_limit_reached',
    'per-identity limit',
  )

  // Submit-gate version binding: only the currently published version accepts
  const publishedForm = {
    id: 'form-1',
    eventId,
    slug: 'cfp',
    status: 'published' as const,
    publishedVersionId: 'version-9',
    limits,
  }
  assert(isFormAcceptingVersion(publishedForm, 'version-9'), 'bound version accepted')
  assert(!isFormAcceptingVersion(publishedForm, 'version-8'), 'drifted version rejected')
  assert(
    evaluateFormSubmitGate(publishedForm, 'version-8', '2026-05-15T00:00:00.000Z', 0, 0).reason ===
      'closed',
    'version drift is a deterministic closed outcome',
  )

  // Dependency cycle detection over version rules
  const cycles = detectRuleCycles(content)
  assert(cycles.length > 0, 'conditional dependency cycle detected')
  const cycleIssues = validateVersionRules(
    content,
    new Map<string, TaxonomyKind>([['track-workshop', 'track']]),
  )
  assert(
    cycleIssues.some((issue) => issue.code === 'dependency_cycle'),
    'rule validation reports dependency cycle',
  )

  // Missing references, invalid operands, unknown routing targets
  const badRule: ElementRule = {
    id: 'rule-c',
    eventId,
    versionId,
    elementId: formatElement.id,
    effect: 'show',
    groups: [
      { groupIndex: 1, conditions: [{ operator: 'eq', operandKey: 'missing-field', value: 'x' }] },
    ],
    position: 1,
  }
  const badRouting: RoutingRule = {
    id: 'route-1',
    eventId,
    versionId,
    position: 1,
    condition: {
      groups: [{ conditions: [{ operator: 'eq', operandKey: 'format', value: 'workshop' }] }],
    },
    actionKind: 'assign_track',
    actionTarget: 'track-unknown',
  }
  const badContent: FormVersionContent = {
    pages: [page],
    elements: [formatElement],
    conditionRules: [badRule],
    routingRules: [badRouting],
  }
  const badIssues = validateVersionRules(
    badContent,
    new Map<string, TaxonomyKind>([['track-workshop', 'track']]),
  )
  assert(
    badIssues.some((issue) => issue.code === 'missing_operand_field'),
    'missing operand field reported',
  )
  assert(
    badIssues.some((issue) => issue.code === 'unknown_routing_target'),
    'unknown routing target reported',
  )

  // Per-page element ordering: position 0 is valid on different pages
  const secondPage: FormPage = { ...page, id: 'page-2', position: 2 }
  const crossPageContent: FormVersionContent = {
    pages: [page, secondPage],
    elements: [
      formatElement,
      { ...workshopElement, id: 'element-workshop-2', pageId: secondPage.id, position: 1 },
    ],
    conditionRules: [],
    routingRules: [],
  }
  assert(
    !validateVersionRules(crossPageContent, new Map()).some(
      (issue) => issue.code === 'duplicate_position',
    ),
    'same position on different pages is valid',
  )
  const samePageContent: FormVersionContent = {
    ...crossPageContent,
    elements: [
      formatElement,
      { ...workshopElement, id: 'element-workshop-2', position: formatElement.position },
    ],
  }
  assert(
    validateVersionRules(samePageContent, new Map()).some(
      (issue) => issue.code === 'duplicate_position',
    ),
    'duplicate position within one page rejected',
  )

  // Empty/malformed condition groups and group index/order
  const emptyGroupsRule: ElementRule = {
    ...(content.conditionRules[0] as ElementRule),
    id: 'rule-empty',
    groups: [],
  }
  const malformedContent: FormVersionContent = {
    ...content,
    conditionRules: [
      emptyGroupsRule,
      {
        ...emptyGroupsRule,
        id: 'rule-malformed',
        groups: [
          { groupIndex: -1, conditions: [] },
          { groupIndex: 2, conditions: [{ operator: 'eq', operandKey: 'format', value: 'x' }] },
          { groupIndex: 1, conditions: [{ operator: 'eq', operandKey: 'format', value: 'y' }] },
          { groupIndex: 1, conditions: [{ operator: 'eq', operandKey: 'format', value: 'z' }] },
        ],
      },
    ],
  }
  const malformedIssues = validateVersionRules(malformedContent, new Map())
  assert(
    malformedIssues.some((issue) => issue.code === 'empty_condition_groups'),
    'rule without groups rejected',
  )
  assert(
    malformedIssues.some((issue) => issue.code === 'empty_condition_group'),
    'empty condition group rejected',
  )
  assert(
    malformedIssues.some((issue) => issue.code === 'invalid_group_index'),
    'invalid group index rejected',
  )
  assert(
    malformedIssues.some((issue) => issue.code === 'unordered_groups'),
    'unordered groups rejected',
  )
  assert(
    malformedIssues.some((issue) => issue.code === 'duplicate_group_index'),
    'duplicate group index rejected',
  )

  // Routing conditions share the element condition validator
  const badRoutingCondition: RoutingRule = {
    ...badRouting,
    condition: {
      groups: [{ conditions: [{ operator: 'eq', operandKey: 'missing-field', value: 'x' }] }],
    },
  }
  const routingConditionIssues = validateVersionRules(
    { ...badContent, routingRules: [badRoutingCondition] },
    new Map<string, TaxonomyKind>([['track-workshop', 'track']]),
  )
  assert(
    routingConditionIssues.some((issue) => issue.code === 'missing_operand_field'),
    'routing condition field reference validated',
  )

  // Kind-aware routing targets: assign_track cannot target a tag key
  const kindAwareTaxonomy: ReadonlyMap<string, TaxonomyKind> = new Map([
    ['track-workshop', 'track'],
    ['ai-tag', 'tag'],
  ])
  const incompatibleContent: FormVersionContent = {
    ...content,
    conditionRules: [],
    routingRules: [
      { ...badRouting, actionKind: 'assign_track', actionTarget: 'ai-tag' },
      { ...badRouting, id: 'route-2', actionKind: 'assign_tag', actionTarget: 'track-workshop' },
    ],
  }
  const incompatibleIssues = validateVersionRules(incompatibleContent, kindAwareTaxonomy)
  assert(
    incompatibleIssues.filter((issue) => issue.code === 'incompatible_routing_target').length >= 2,
    'action-kind/taxonomy-kind compatibility enforced',
  )

  // UTC instant contract
  assert(isValidUtcInstant('2026-05-15T00:00:00.000Z'), 'canonical UTC instant accepted')
  assert(!isValidUtcInstant('2026-05-15'), 'date-only instant rejected')
  assert(!isValidUtcInstant('2026-05-15T00:00:00+02:00'), 'offset instant rejected')
  assert(!isValidUtcInstant('2026-05-15T00:00:00Z'), 'non-canonical instant rejected')
  assert(!isValidUtcInstant('not-a-date'), 'unparseable instant rejected')

  // TTL and addMillis contract
  assert(isValidTtl(60_000, MAX_SUBMITTER_TOKEN_TTL_MS), 'positive bounded TTL accepted')
  assert(!isValidTtl(0, MAX_SUBMITTER_TOKEN_TTL_MS), 'zero TTL rejected')
  assert(!isValidTtl(-1, MAX_SUBMITTER_TOKEN_TTL_MS), 'negative TTL rejected')
  assert(!isValidTtl(Number.NaN, MAX_SUBMITTER_TOKEN_TTL_MS), 'NaN TTL rejected')
  assert(
    !isValidTtl(MAX_SUBMITTER_TOKEN_TTL_MS + 1, MAX_SUBMITTER_TOKEN_TTL_MS),
    'over-bounded TTL rejected',
  )
  assert(
    addMillis('2026-05-15T00:00:00.000Z', 60_000) === '2026-05-15T00:01:00.000Z',
    'addMillis advances a canonical instant',
  )
  assertThrows(() => addMillis('2026-05-15T00:00:00.000Z', 0), 'zero millis rejected')
  assertThrows(() => addMillis('2026-05-15T00:00:00.000Z', Number.NaN), 'NaN millis rejected')
  assertThrows(
    () => addMillis('2026-05-15T00:00:00.000Z', Number.MAX_SAFE_INTEGER),
    'overflowing millis rejected',
  )
  assertThrows(() => addMillis('2026-05-15', 60_000), 'invalid instant rejected by addMillis')

  // Published-version freeze invariant
  const draftVersion: FormVersion = {
    id: versionId,
    eventId,
    formId: 'form-1',
    version: 1,
    status: 'draft',
    contentHash: null,
    publishedAt: null,
    updatedAt: '2026-04-15T00:00:00.000Z',
  }
  assert(validateVersionFreeze(draftVersion).length === 0, 'draft version freeze is valid')
  const brokenPublished: FormVersion = {
    ...draftVersion,
    status: 'published',
    contentHash: null,
    publishedAt: '2026-05-01T00:00:00.000Z',
  }
  assert(
    validateVersionFreeze(brokenPublished).some((issue) => issue.code === 'published_without_hash'),
    'published version without content hash rejected',
  )
  const published: FormVersion = {
    ...draftVersion,
    status: 'published',
    contentHash: 'abc',
    publishedAt: '2026-05-01T00:00:00.000Z',
  }
  assert(validateVersionFreeze(published).length === 0, 'published freeze is valid')

  // Content-hash canonicalization stability
  const hashA = await computeFormVersionContentHash(content)
  const hashB = await computeFormVersionContentHash({ ...content })
  assert(hashA === hashB, 'content hash is stable for identical content')
  const answers: AnswerMap = { format: 'workshop' }
  const changedContent: FormVersionContent = {
    ...content,
    routingRules: [{ ...badRouting, actionTarget: 'track-workshop' }],
  }
  assert(
    (await computeFormVersionContentHash(changedContent)) !== hashA,
    'content hash changes with content',
  )
  const subHashA = await computeSubmissionContentHash('Talk', answers, versionId)
  const subHashB = await computeSubmissionContentHash('Talk', answers, versionId)
  assert(subHashA === subHashB, 'submission hash is stable')

  console.log('m2 self-check passed')
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn()
  } catch {
    return
  }
  throw new Error(`M2 self-check failed: ${message}`)
}

main().catch((error: unknown) => {
  console.error(error)
  throw error
})
