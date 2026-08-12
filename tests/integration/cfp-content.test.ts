import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { applyMigrations, seedDemoConf } from './m2b-helpers'
import { bindings } from './m2c-helpers'
import app from '../../src/server'

/**
 * What the published call for papers actually ASKS FOR.
 *
 * A form that collects a title and a format is not a call for papers. A proposal
 * could be submitted complete with nothing but a title, which left the programme
 * committee with nothing to review — and no amount of machinery underneath makes
 * up for a call that never asked the questions.
 *
 * These are assertions about the SHAPE the published form serves, not about the
 * form builder: the builder already supports every type, flag and rule used here,
 * and the organizer can edit all of it. What was missing was a call worth
 * answering. The rendering and validation of this shape is exercised in
 * tests/unit/app/cfp-seeded-form.test.tsx.
 */
beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

type Element = {
  readonly id: string
  readonly fieldKey: string | null
  readonly label: string | null
  readonly required: boolean
  readonly questionType: string | null
  readonly options: readonly string[]
  readonly pageId: string
  readonly maxLength: number | null
}

type Definition = {
  readonly closesAt: string | null
  readonly opensAt: string | null
  readonly pages: readonly { readonly id: string; readonly kind: string; readonly title: string }[]
  readonly elements: readonly Element[]
  readonly conditionRules: readonly {
    readonly elementId: string
    readonly effect: string
    readonly groups: readonly {
      readonly conditions: readonly {
        readonly operator: string
        readonly operandKey: string
        readonly value: unknown
      }[]
    }[]
  }[]
}

async function definition(): Promise<Definition> {
  const response = await app.request('/api/public/cfp/demo-conf-2026/cfp', undefined, bindings())
  expect(response.status).toBe(200)
  return (await response.json()) as Definition
}

const byKey = (form: Definition, fieldKey: string): Element | undefined =>
  form.elements.find((element) => element.fieldKey === fieldKey)

describe('the published call for papers collects a real proposal', () => {
  it('asks for an abstract as long text, required', async () => {
    const abstract = byKey(await definition(), 'abstract')
    expect(abstract).toBeDefined()
    expect(abstract?.questionType).toBe('long_text')
    expect(abstract?.required).toBe(true)
    expect(abstract?.label).toBe('Abstract')
  })

  it('asks for a track, offering the event’s configured tracks as options', async () => {
    const form = await definition()
    const track = byKey(form, 'track')
    expect(track?.questionType).toBe('single_choice')
    expect(track?.required).toBe(true)
    // The options a submitter picks from have to BE the programme's tracks, not a
    // second list that drifts from them.
    expect(track?.options).toEqual(['Platform & Infra', 'AI Engineering', 'Developer Experience'])
  })

  it('offers presentable session formats rather than raw identifiers', async () => {
    const format = byKey(await definition(), 'format')
    expect(format?.questionType).toBe('single_choice')
    expect(format?.required).toBe(true)
    expect(format?.options).toEqual(['Talk', 'Workshop', 'Lightning talk'])
    // The defect was lowercase internals on a public page. Any option that is not
    // presentable as-is fails this, whatever its spelling.
    for (const option of format?.options ?? []) {
      expect(option).toMatch(/^[A-Z]/)
      expect(option).not.toMatch(/[_-]/)
    }
  })

  it('asks for an audience level with three levels', async () => {
    const audience = byKey(await definition(), 'audience_level')
    expect(audience?.questionType).toBe('single_choice')
    expect(audience?.options).toEqual(['Beginner', 'Intermediate', 'Advanced'])
  })

  it('asks for a required key takeaway as short text', async () => {
    const takeaway = byKey(await definition(), 'key_takeaway')
    expect(takeaway?.questionType).toBe('short_text')
    expect(takeaway?.required).toBe(true)
    expect(takeaway?.label).toBe('Key takeaway')
  })

  it('asks the participant about themselves on the participant step', async () => {
    const form = await definition()
    const participantPage = form.pages.find((page) => page.title === 'Participant information')
    expect(participantPage).toBeDefined()
    const onParticipantPage = form.elements
      .filter((element) => element.pageId === participantPage?.id)
      .map((element) => element.fieldKey)
    // The step used to be a heading over nothing while still consuming a step in
    // the progress indicator.
    expect(onParticipantPage).toEqual(
      expect.arrayContaining(['speaker_bio', 'job_title', 'company']),
    )
    expect(byKey(form, 'speaker_bio')?.questionType).toBe('long_text')
    expect(byKey(form, 'speaker_bio')?.required).toBe(true)
  })

  it('spans short text, long text and dropdown questions', async () => {
    const types = new Set((await definition()).elements.map((element) => element.questionType))
    expect(types).toContain('short_text')
    expect(types).toContain('long_text')
    expect(types).toContain('single_choice')
  })

  it('mixes required and optional questions', async () => {
    const form = await definition()
    expect(form.elements.some((element) => element.required)).toBe(true)
    expect(form.elements.some((element) => !element.required)).toBe(true)
  })
})

describe('the published call for papers publishes its own deadline', () => {
  it('serves the close date so a logged-out portal can show it', async () => {
    const form = await definition()
    // The window was already enforced on the write path; what was missing was
    // telling anyone about it before they spend an evening writing a proposal.
    expect(form.closesAt).toBe('2026-12-31T23:59:59.000Z')
    expect(form.opensAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('conditional logic is carried by the definition, not by the client', () => {
  it('shows AND requires the workshop question only for the workshop format', async () => {
    const form = await definition()
    const conditional = byKey(form, 'workshop_details')
    expect(conditional).toBeDefined()
    const rules = form.conditionRules.filter((rule) => rule.elementId !== undefined)
    const forConditional = rules.filter(
      (rule) =>
        rule.groups.some((group) =>
          group.conditions.some((condition) => condition.operandKey === 'format'),
        ) && rule.elementId === form.elements.find((e) => e.fieldKey === 'workshop_details')?.id,
    )
    const effects = new Set(forConditional.map((rule) => rule.effect))
    // Visibility alone leaves a hidden required field, or a shown optional one.
    // Both effects are needed for "appears and is then mandatory".
    expect(effects).toContain('show')
    expect(effects).toContain('require')
    for (const rule of forConditional) {
      for (const group of rule.groups) {
        for (const condition of group.conditions) {
          expect(condition.operator).toBe('eq')
          expect(condition.value).toBe('Workshop')
        }
      }
    }
    // The column-level flag must NOT be what makes it required, or it is required
    // even while hidden for a Talk.
    expect(conditional?.required).toBe(false)
  })
})

/**
 * The uniqueness grain of cfp_condition_rules (migration 0015).
 *
 * The original key was UNIQUE (version_id, element_id, group_index,
 * condition_index) — it omitted rule_id, so a version could hold only ONE rule
 * per element. The domain reads several: visibility comes from show/hide rules and
 * requiredness from require rules, and pairing both on one question is the
 * canonical conditional configuration. The old grain rejected it identically
 * whether it arrived from the seed or from an organizer using the condition-rule
 * editor, which is why this is a schema fix and not a seed workaround.
 *
 * These cases persist rules through the DATABASE rather than the seed, so they
 * still hold if the seed changes shape, and they check that the rebuild kept the
 * guards the dropped table carried.
 */
describe('a question can carry two distinct condition rules', () => {
  const EVENT = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
  const VERSION = 'f0000000-0000-4000-8000-000000000002'
  const ELEMENT = 'f0000000-0000-4000-8000-000000000202'

  const insertRule = async (id: string, ruleId: string, effect: string, groupIndex: number) =>
    env.DB.prepare(
      `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
         group_index, condition_index, operator, operand_key, value_json, effect, position)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'eq', 'format', '"Workshop"', ?, 0)`,
    )
      .bind(EVENT, id, ruleId, VERSION, ELEMENT, groupIndex, effect)
      .run()

  it('persists show and require for one element at the same natural group index', async () => {
    // Same element, same group_index, same condition_index — distinguished only by
    // rule_id. This is the exact insert the old grain rejected.
    await insertRule('11111111-1111-4111-8111-111111111111', 'rule-show-x', 'show', 0)
    await insertRule('22222222-2222-4222-8222-222222222222', 'rule-require-x', 'require', 0)

    const read = await env.DB.prepare(
      `SELECT effect FROM cfp_condition_rules
        WHERE element_id = ? AND rule_id IN ('rule-show-x', 'rule-require-x')
        ORDER BY effect`,
    )
      .bind(ELEMENT)
      .all<{ effect: string }>()
    expect(read.results.map((row) => row.effect)).toEqual(['require', 'show'])
  })

  it('still rejects a duplicate condition coordinate within one rule', async () => {
    await insertRule('33333333-3333-4333-8333-333333333333', 'rule-dup', 'show', 0)
    // Same rule, same group, same condition index: genuinely a duplicate.
    await expect(
      insertRule('44444444-4444-4444-8444-444444444444', 'rule-dup', 'show', 0),
    ).rejects.toThrow(/UNIQUE/i)
  })

  it('kept the publish-immutability guard the rebuilt table carried', async () => {
    // The seeded version is published, so the seeded rules must refuse mutation.
    await expect(
      env.DB.prepare(`UPDATE cfp_condition_rules SET position = 9 WHERE version_id = ?`)
        .bind(VERSION)
        .run(),
    ).rejects.toThrow(/immutable/i)
    await expect(
      env.DB.prepare(`DELETE FROM cfp_condition_rules WHERE version_id = ?`).bind(VERSION).run(),
    ).rejects.toThrow(/immutable/i)
  })

  it('kept the same-version guard the rebuilt table carried', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
           group_index, condition_index, operator, operand_key, value_json, effect, position)
         VALUES (?, '55555555-5555-4555-8555-555555555555', 'rule-cross', ?, ?, 0, 0,
                 'eq', 'format', '"Workshop"', 'show', 0)`,
      )
        // A version id that is not the element's own version.
        .bind(EVENT, 'f0000000-0000-4000-8000-0000000000ff', ELEMENT)
        .run(),
    ).rejects.toThrow()
  })
})
