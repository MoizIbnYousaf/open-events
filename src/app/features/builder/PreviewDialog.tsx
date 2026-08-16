import { Component, Suspense, lazy, type ReactNode } from 'react'

import type { TaxonomyItemDto } from '../../../application'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'

import type { BuilderDraft } from './builder-model'

const PreviewEngine = lazy(() => import('./preview-engine'))

interface PreviewDialogProps {
  readonly open: boolean
  readonly draft: BuilderDraft
  readonly taxonomyItems: readonly TaxonomyItemDto[]
  readonly onClose: () => void
}

/**
 * The preview is a lazily fetched chunk, so a flaky network can fail it on its
 * own. Without a boundary here that failure escalated to the app-level crash
 * screen and took the whole builder — and the operator's unsaved draft — down
 * with it. Recovery is local: remount the subtree and let the import retry.
 */
class PreviewLoadBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }

  private readonly retry = (): void => {
    this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="grid justify-items-start gap-3">
        <AlertLive>The preview could not be loaded.</AlertLive>
        <Button type="button" variant="outline" size="sm" onClick={this.retry}>
          Try again
        </Button>
      </div>
    )
  }
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
        <PreviewLoadBoundary>
          <Suspense
            fallback={
              <div aria-busy="true" aria-label="Loading preview" className="grid gap-2.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
                <StatusLive aria-live="polite">Loading the preview…</StatusLive>
              </div>
            }
          >
            <PreviewEngine autoFocus content={draft.content} taxonomyItems={taxonomyItems} />
          </Suspense>
        </PreviewLoadBoundary>
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
