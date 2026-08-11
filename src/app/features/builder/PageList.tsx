import type { FormElement, FormPage } from '../../../domain'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { DocumentIcon } from '../../../components/ui/icons'

import ElementEditor from './ElementEditor'
import ReorderControls from './ReorderControls'

interface PageListProps {
  readonly pages: readonly FormPage[]
  readonly elements: readonly FormElement[]
  readonly invalidElementId: string | null
  readonly onUpdateElement: (elementId: string, patch: Partial<FormElement>) => void
  readonly onMoveElement: (elementId: string, direction: 'up' | 'down') => void
  readonly registerLabelRef: (elementId: string) => (node: HTMLInputElement | null) => void
}

export default function PageList({
  pages,
  elements,
  invalidElementId,
  onUpdateElement,
  onMoveElement,
  registerLabelRef,
}: PageListProps) {
  return (
    <div className="grid gap-3">
      {pages.map((page) => {
        const pageElements = elements.filter((element) => element.pageId === page.id)
        return (
          // One card per page: the form a speaker walks through one screen at
          // a time is edited one card at a time.
          <section key={page.id}>
            <Card>
              <CardHeader>
                <CardTitle level={2}>{page.title}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-0">
                {pageElements.length === 0 ? (
                  <EmptyState
                    icon={<DocumentIcon size={20} />}
                    title="Add a question to this page"
                    description="Pages with no questions are skipped when the form is published."
                  />
                ) : null}
                {pageElements.map((element, index) => (
                  // Hairline-divided rows rather than a stack of boxes: the
                  // elements belong to the page, so the page's edge is the only
                  // one drawn.
                  <div
                    key={element.id}
                    className="grid gap-2 border-border py-3 first:pt-0 last:pb-0 not-last:border-b"
                  >
                    <ElementEditor
                      element={element}
                      invalid={invalidElementId === element.id}
                      labelRef={registerLabelRef(element.id)}
                      onUpdate={(patch) => onUpdateElement(element.id, patch)}
                    />
                    <ReorderControls
                      canMoveUp={index > 0}
                      canMoveDown={index < pageElements.length - 1}
                      onMoveUp={() => onMoveElement(element.id, 'up')}
                      onMoveDown={() => onMoveElement(element.id, 'down')}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )
      })}
    </div>
  )
}
