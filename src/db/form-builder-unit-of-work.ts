import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import type { FormBuilderUnitOfWork } from '../application/ports/form-builder-unit-of-work'
import type {
  ElementCondition,
  FormElement,
  FormPage,
  FormVersionContent,
  RoutingRule,
} from '../domain'

/**
 * D1 `batch()` adapter for the frozen FormBuilderUnitOfWork port.
 *
 * saveDraft: version row + full content replacement in one batch; all content
 * statements are guarded on the version being in the NEW state (draft +
 * updated_at = new value), so a failed optimistic precondition no-ops every
 * content write and the batch resolves to `conflict` with zero writes.
 * publish: dual-conditioned freeze + form-pointer bind (both-or-neither);
 * the freeze writes updated_at = published_at per the M2B decision.
 */
export function createFormBuilderUnitOfWork(db: D1Database): FormBuilderUnitOfWork {
  return {
    async saveDraft({ expected, version, content }) {
      const newUpdatedAt = version.updatedAt
      const statements: D1PreparedStatement[] = []
      if (expected === null) {
        statements.push(
          db
            .prepare(
              `INSERT INTO cfp_form_versions
                 (event_id, form_id, id, version, status, content_hash, published_at, updated_at)
               VALUES (?, ?, ?, ?, 'draft', NULL, NULL, ?)
               ON CONFLICT(event_id, form_id, version) DO NOTHING`,
            )
            .bind(version.eventId, version.formId, version.id, version.version, newUpdatedAt),
        )
      } else {
        statements.push(
          db
            .prepare(
              `UPDATE cfp_form_versions
               SET content_hash = NULL, published_at = NULL, updated_at = ?
               WHERE event_id = ? AND id = ? AND status = 'draft' AND updated_at = ?`,
            )
            .bind(newUpdatedAt, version.eventId, version.id, expected.updatedAt),
        )
      }

      const guard = versionGuard(version.eventId, version.id, newUpdatedAt)
      statements.push(
        ...deleteStatements(db, version.eventId, version.id, guard),
        ...insertPageStatements(db, content, guard),
        ...insertElementStatements(db, content, guard),
        ...insertConditionRuleStatements(db, content, guard),
        ...insertRoutingRuleStatements(db, content, guard),
      )

      const results = await db.batch(statements)
      const versionResult = results[0]
      if (versionResult === undefined) {
        throw new Error('saveDraft batch returned no version result')
      }
      return versionResult.meta.changes === 1 ? { outcome: 'saved' } : { outcome: 'conflict' }
    },

    async publish({ expected, publishedVersion, expectedForm, form }) {
      if (publishedVersion.contentHash === null || publishedVersion.publishedAt === null) {
        throw new Error('publish requires a published version with contentHash and publishedAt')
      }
      const newUpdatedAt = publishedVersion.publishedAt
      const expectedPointer = expectedForm.publishedVersionId
      const results = await db.batch([
        db
          .prepare(
            `UPDATE cfp_form_versions
             SET status = 'published', content_hash = ?, published_at = ?, updated_at = ?
             WHERE event_id = ? AND id = ? AND status = 'draft' AND updated_at = ?
               AND EXISTS (SELECT 1 FROM cfp_forms
                           WHERE event_id = ? AND id = ? AND published_version_id IS ?)`,
          )
          .bind(
            publishedVersion.contentHash,
            publishedVersion.publishedAt,
            newUpdatedAt,
            publishedVersion.eventId,
            publishedVersion.id,
            expected.updatedAt,
            expectedForm.eventId,
            expectedForm.id,
            expectedPointer,
          ),
        db
          .prepare(
            `UPDATE cfp_forms
             SET status = 'published', published_version_id = ?
             WHERE event_id = ? AND id = ? AND published_version_id IS ?
               AND EXISTS (SELECT 1 FROM cfp_form_versions
                           WHERE event_id = ? AND id = ? AND status = 'published'
                             AND content_hash = ? AND published_at = ? AND updated_at = ?)`,
          )
          .bind(
            publishedVersion.id,
            form.eventId,
            form.id,
            expectedPointer,
            publishedVersion.eventId,
            publishedVersion.id,
            publishedVersion.contentHash,
            publishedVersion.publishedAt,
            newUpdatedAt,
          ),
      ])
      const freeze = results[0]
      if (freeze === undefined) {
        throw new Error('publish batch returned no freeze result')
      }
      return freeze.meta.changes === 1 ? { outcome: 'published' } : { outcome: 'conflict' }
    },
  }
}

interface VersionGuard {
  readonly sql: string
  readonly binds: readonly string[]
}

function versionGuard(eventId: string, versionId: string, updatedAt: string): VersionGuard {
  return {
    sql: `EXISTS (SELECT 1 FROM cfp_form_versions
                   WHERE event_id = ? AND id = ? AND status = 'draft' AND updated_at = ?)`,
    binds: [eventId, versionId, updatedAt],
  }
}

function deleteStatements(
  db: D1Database,
  eventId: string,
  versionId: string,
  guard: VersionGuard,
): D1PreparedStatement[] {
  const targets = ['cfp_routing_rules', 'cfp_condition_rules', 'cfp_elements', 'cfp_pages']
  return targets.map((table) =>
    db
      .prepare(
        `DELETE FROM ${table}
         WHERE event_id = ? AND version_id = ? AND ${guard.sql}`,
      )
      .bind(eventId, versionId, ...guard.binds),
  )
}

function insertPageStatements(
  db: D1Database,
  content: FormVersionContent,
  guard: VersionGuard,
): D1PreparedStatement[] {
  return content.pages.map((page: FormPage) =>
    db
      .prepare(
        `INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
      )
      .bind(
        page.eventId,
        page.id,
        page.versionId,
        page.position,
        page.kind,
        page.title,
        page.content,
        ...guard.binds,
      ),
  )
}

function insertElementStatements(
  db: D1Database,
  content: FormVersionContent,
  guard: VersionGuard,
): D1PreparedStatement[] {
  return content.elements.map((element: FormElement) =>
    db
      .prepare(
        `INSERT INTO cfp_elements
           (event_id, id, version_id, page_id, position, kind, field_key, label,
            required, max_length, question_type, options_json)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
      )
      .bind(
        element.eventId,
        element.id,
        element.versionId,
        element.pageId,
        element.position,
        element.kind,
        element.fieldKey,
        element.label,
        element.required ? 1 : 0,
        element.maxLength,
        element.questionType,
        element.options.length === 0 ? null : JSON.stringify(element.options),
        ...guard.binds,
      ),
  )
}

function insertConditionRuleStatements(
  db: D1Database,
  content: FormVersionContent,
  guard: VersionGuard,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []
  for (const rule of content.conditionRules) {
    for (const group of rule.groups) {
      for (const [conditionIndex, condition] of group.conditions.entries()) {
        statements.push(
          db
            .prepare(
              `INSERT INTO cfp_condition_rules
                 (event_id, id, rule_id, version_id, element_id, group_index,
                  condition_index, operator, operand_key, value_json, effect, position)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
            )
            .bind(
              rule.eventId,
              `${rule.id}:${group.groupIndex}:${conditionIndex}`,
              rule.id,
              rule.versionId,
              rule.elementId,
              group.groupIndex,
              conditionIndex,
              condition.operator,
              condition.operandKey,
              condition.value === null ? null : JSON.stringify(condition.value),
              rule.effect,
              rule.position,
              ...guard.binds,
            ),
        )
      }
    }
  }
  return statements
}

function insertRoutingRuleStatements(
  db: D1Database,
  content: FormVersionContent,
  guard: VersionGuard,
): D1PreparedStatement[] {
  return content.routingRules.map((rule: RoutingRule) =>
    db
      .prepare(
        `INSERT INTO cfp_routing_rules
           (event_id, id, version_id, position, condition_json, action_kind, action_target)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
      )
      .bind(
        rule.eventId,
        rule.id,
        rule.versionId,
        rule.position,
        JSON.stringify(serializeConditionSet(rule.condition)),
        rule.actionKind,
        rule.actionTarget,
        ...guard.binds,
      ),
  )
}

function serializeConditionSet(condition: {
  readonly groups: readonly {
    readonly conditions: readonly ElementCondition[]
  }[]
}): unknown {
  return {
    groups: condition.groups.map((group) => ({
      conditions: group.conditions.map((item) => ({
        operator: item.operator,
        operandKey: item.operandKey,
        value: item.value,
      })),
    })),
  }
}
