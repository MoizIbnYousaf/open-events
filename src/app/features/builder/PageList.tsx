import type { FormElement, FormPage } from '../../../domain'

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
    <div className="grid gap-6">
      {pages.map((page) => {
        const pageElements = elements.filter((element) => element.pageId === page.id)
        return (
          <section key={page.id} className="grid gap-3">
            <h2 className="text-base font-semibold">{page.title}</h2>
            {pageElements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No elements on this page.</p>
            ) : null}
            {pageElements.map((element, index) => (
              <div key={element.id} className="grid gap-2">
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
          </section>
        )
      })}
    </div>
  )
}
