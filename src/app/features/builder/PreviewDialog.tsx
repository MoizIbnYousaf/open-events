import { Suspense, lazy } from 'react'

import type { TaxonomyItemDto } from '../../../application'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog'

import type { BuilderDraft } from './builder-model'

const PreviewEngine = lazy(() => import('./preview-engine'))

interface PreviewDialogProps {
  readonly open: boolean
  readonly draft: BuilderDraft
  readonly taxonomyItems: readonly TaxonomyItemDto[]
  readonly onClose: () => void
}

export default function PreviewDialog({ open, draft, taxonomyItems, onClose }: PreviewDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle>Preview</DialogTitle>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading preview…</p>}>
          <PreviewEngine content={draft.content} taxonomyItems={taxonomyItems} />
        </Suspense>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
