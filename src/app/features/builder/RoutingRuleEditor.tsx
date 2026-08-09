import type { RoutingRule, RoutingActionKind } from '../../../domain'
import { ROUTING_ACTIONS } from '../../../domain'
import type { TaxonomyItemDto } from '../../../application'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'

import TaxonomyPicker from './TaxonomyPicker'

interface RoutingRuleEditorProps {
  readonly rules: readonly RoutingRule[]
  readonly taxonomyItems: readonly TaxonomyItemDto[]
  readonly taxonomyUnavailable: boolean
  readonly onUpdateRule: (ruleId: string, patch: Partial<RoutingRule>) => void
}

export default function RoutingRuleEditor({
  rules,
  taxonomyItems,
  taxonomyUnavailable,
  onUpdateRule,
}: RoutingRuleEditorProps) {
  if (rules.length === 0) {
    return (
      <section className="grid gap-2 rounded-lg border p-3">
        <h3 className="text-sm font-semibold">Routing</h3>
        <p className="text-sm text-muted-foreground">No routing rules yet.</p>
      </section>
    )
  }
  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">Routing</h3>
      {rules.map((rule) => {
        const needsTarget =
          (rule.actionKind === 'assign_track' || rule.actionKind === 'assign_tag') &&
          !taxonomyUnavailable
        return (
          <div key={rule.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Action kind</span>
              <Select
                value={rule.actionKind}
                onValueChange={(actionKind) =>
                  onUpdateRule(rule.id, {
                    actionKind: actionKind as RoutingActionKind,
                    actionTarget: actionKind === 'manual_review' ? null : rule.actionTarget,
                  })
                }
              >
                <SelectTrigger aria-label="Action kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTING_ACTIONS.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsTarget ? (
              <TaxonomyPicker
                kind={rule.actionKind === 'assign_track' ? 'track' : 'tag'}
                items={taxonomyItems}
                value={rule.actionTarget}
                onChange={(target) => onUpdateRule(rule.id, { actionTarget: target })}
              />
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
