import { useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import type { SaveFormDraftInput } from '../../../application'
import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import {
  adminFormQueryKeys,
  useFormDraft,
  useFormVersions,
  usePublishForm,
  useUpdateFormDraft,
} from '../../queries/admin-forms'
import { useTaxonomies } from '../../queries/admin-events'
import type { ElementRule, FormElement, RoutingRule } from '../../../domain'
import {
  DeniedState,
  ExpiredSessionState,
  ForbiddenState,
  LoadErrorState,
} from '../admin/AdminStates'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import {
  conditionValueKey,
  dtoToBuilderDraft,
  moveElementInDraft,
  rebindDraft,
  toSaveInput,
  validateBuilderContent,
  type BuilderDraft,
} from './builder-model'
import ConditionRuleEditor from './ConditionRuleEditor'
import PageList from './PageList'
import PreviewDialog from './PreviewDialog'
import PublishConfirmDialog from './PublishConfirmDialog'
import RoutingRuleEditor from './RoutingRuleEditor'

export default function BuilderEditor() {
  return <BuilderEditorByForm />
}

function BuilderEditorByForm() {
  const params = useParams({ strict: false })
  const formId = params.formId as string | undefined
  // Keying the screen by formId resets all form-scoped local state on a route
  // form-id change, so a new form can never inherit prior-form content.
  return <BuilderEditorScreen key={formId ?? 'no-form'} formId={formId} />
}

type SaveErrorState =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'error'; readonly message: string }

function BuilderEditorScreen({ formId }: { readonly formId: string | undefined }) {
  const search = useSearch({ strict: false }) as { eventSlug?: string }
  const eventSlug = search.eventSlug
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const draftQuery = useFormDraft(formId)
  const versionsQuery = useFormVersions(formId)
  const taxonomiesQuery = useTaxonomies(eventSlug)
  const save = useUpdateFormDraft(formId ?? '')
  const publish = usePublishForm(formId ?? '')

  const [draft, setDraft] = useState<BuilderDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<SaveErrorState | null>(null)
  const [conflictScope, setConflictScope] = useState<'save' | 'publish' | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [retryPending, setRetryPending] = useState(false)
  const dirtyRef = useRef(false)
  const retryInFlightRef = useRef(false)
  const previewButtonRef = useRef<HTMLButtonElement | null>(null)
  const labelRefs = useRef(new Map<string, HTMLInputElement | null>())
  const valueRefs = useRef(new Map<string, HTMLInputElement | null>())
  const attemptedSaveRef = useRef<SaveFormDraftInput | null>(null)

  useEffect(() => {
    document.title = 'Form builder — SpeakerOps'
  }, [])

  useEffect(() => {
    if (draftQuery.data === undefined) return
    // Background draft data must never clobber in-flight edits; explicit user
    // transitions (save rebind, reload latest, retry, publish fork) apply data
    // directly and clear dirty themselves.
    if (dirtyRef.current) return
    setDraft(dtoToBuilderDraft(draftQuery.data))
    setDirty(false)
  }, [draftQuery.data])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    withResolver: true,
    enableBeforeUnload: false,
  })

  const registerLabelRef = (elementId: string) => (node: HTMLInputElement | null) => {
    if (node === null) {
      labelRefs.current.delete(elementId)
    } else {
      labelRefs.current.set(elementId, node)
    }
  }

  const registerValueRef = (key: string) => (node: HTMLInputElement | null) => {
    if (node === null) {
      valueRefs.current.delete(key)
    } else {
      valueRefs.current.set(key, node)
    }
  }

  const updateElement = (elementId: string, patch: Partial<FormElement>) => {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            content: {
              ...current.content,
              elements: current.content.elements.map((element) =>
                element.id === elementId ? { ...element, ...patch } : element,
              ),
            },
          },
    )
    setDirty(true)
    dirtyRef.current = true
  }

  const updateConditionRule = (ruleId: string, patch: Partial<ElementRule>) => {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            content: {
              ...current.content,
              conditionRules: current.content.conditionRules.map((rule) =>
                rule.id === ruleId ? { ...rule, ...patch } : rule,
              ),
            },
          },
    )
    setDirty(true)
    dirtyRef.current = true
  }

  const updateRoutingRule = (ruleId: string, patch: Partial<RoutingRule>) => {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            content: {
              ...current.content,
              routingRules: current.content.routingRules.map((rule) =>
                rule.id === ruleId ? { ...rule, ...patch } : rule,
              ),
            },
          },
    )
    setDirty(true)
    dirtyRef.current = true
  }

  const moveElement = (elementId: string, direction: 'up' | 'down') => {
    if (draft === null) return
    const result = moveElementInDraft(draft, elementId, direction)
    if (!result.moved) return
    setDraft(result.draft)
    setDirty(true)
    dirtyRef.current = true
    setStatusMessage(`Moved to position ${result.pageIndex}`)
  }

  const saveDraft = () => {
    if (draft === null || formId === undefined) return
    setStatusMessage(null)
    setSaveError(null)
    setConflictScope(null)
    const issue = validateBuilderContent(draft.content)
    if (issue !== null) {
      setValidationMessage('Please fix the highlighted fields.')
      if (issue.kind === 'label') {
        labelRefs.current.get(issue.elementId)?.focus()
      } else {
        valueRefs.current
          .get(conditionValueKey(issue.ruleId, issue.groupIndex, issue.conditionIndex))
          ?.focus()
      }
      return
    }
    setValidationMessage(null)
    performSave(toSaveInput(draft))
  }

  const performSave = (input: SaveFormDraftInput) => {
    if (formId === undefined) return
    attemptedSaveRef.current = input
    save.mutate(input, {
      onSuccess: (updated) => {
        attemptedSaveRef.current = null
        const rebound = rebindDraft(updated, input)
        setDraft(rebound)
        setDirty(false)
        dirtyRef.current = false
        setStatusMessage('Saved')
        void queryClient.invalidateQueries({
          queryKey: adminFormQueryKeys.versions(formId),
        })
      },
      onError: (error) => {
        handleMutationError(error, 'save')
      },
    })
  }

  const confirmPublish = () => {
    if (formId === undefined) return
    performPublish()
  }

  const performPublish = () => {
    if (formId === undefined) return
    publish.mutate(undefined, {
      onSuccess: async () => {
        setPublishOpen(false)
        setStatusMessage('Published')
        setDirty(false)
        dirtyRef.current = false
        await Promise.all([
          queryClient.refetchQueries({ queryKey: adminFormQueryKeys.draft(formId) }),
          queryClient.refetchQueries({ queryKey: adminFormQueryKeys.versions(formId) }),
        ])
      },
      onError: (error) => {
        setPublishOpen(false)
        handleMutationError(error, 'publish')
      },
    })
  }

  const handleMutationError = (error: unknown, scope: 'save' | 'publish') => {
    const code = getApiErrorCode(error)
    if (code === 'conflict') {
      setConflictScope(scope)
      return
    }
    if (code === 'forbidden') {
      setSaveError({ kind: 'forbidden' })
      return
    }
    if (code === 'not_found') {
      setSaveError({ kind: 'denied' })
      return
    }
    if (code === 'unauthorized') {
      setSaveError({ kind: 'expired' })
      queryClient.clear()
      window.setTimeout(() => void navigate({ to: '/admin' }), 100)
      return
    }
    setSaveError({
      kind: 'error',
      message: getApiErrorMessage(error, scope === 'save' ? 'Unable to save' : 'Unable to publish'),
    })
  }

  const reloadLatest = async () => {
    const result = await draftQuery.refetch()
    if (result.isError || result.data === undefined) {
      return
    }
    attemptedSaveRef.current = null
    setConflictScope(null)
    setDraft(dtoToBuilderDraft(result.data))
    setDirty(false)
    dirtyRef.current = false
  }

  const discardChanges = () => {
    if (draftQuery.data === undefined) return
    attemptedSaveRef.current = null
    setDraft(dtoToBuilderDraft(draftQuery.data))
    setDirty(false)
    dirtyRef.current = false
    setConflictScope(null)
  }

  const retryAfterReload = async () => {
    // Synchronous reentrancy guard: closes the same-tick double-click gap
    // before any state update can render the disabled button.
    if (retryInFlightRef.current) return
    retryInFlightRef.current = true
    setRetryPending(true)
    try {
      const scope = conflictScope
      const result = await draftQuery.refetch()
      if (result.isError || result.data === undefined) {
        setConflictScope(scope)
        return
      }
      setConflictScope(null)
      setDraft(dtoToBuilderDraft(result.data))
      setDirty(false)
      dirtyRef.current = false
      if (scope === 'publish') {
        performPublish()
        return
      }
      const attempted = attemptedSaveRef.current
      if (attempted !== null) {
        performSave(attempted)
      }
    } finally {
      retryInFlightRef.current = false
      setRetryPending(false)
    }
  }

  const closePreview = () => {
    setPreviewOpen(false)
    previewButtonRef.current?.focus()
  }

  if (draftQuery.isError && draft === null) {
    const code = getApiErrorCode(draftQuery.error)
    if (code === 'forbidden') return <ForbiddenState />
    if (code === 'not_found') return <DeniedState />
    if (code === 'unauthorized') {
      return (
        <ExpiredSessionState
          onLogin={() => {
            queryClient.clear()
            void navigate({ to: '/admin' })
          }}
        />
      )
    }
    return (
      <LoadErrorState
        message={getApiErrorMessage(draftQuery.error, 'Unable to load the draft')}
        onRetry={() => void draftQuery.refetch()}
      />
    )
  }

  if (draft === null) {
    return (
      <Card aria-busy="true" aria-label="Loading form builder">
        <CardContent className="grid gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>
    )
  }

  const taxonomyItems = taxonomiesQuery.data?.items ?? []
  const taxonomyUnavailable =
    eventSlug === undefined || (taxonomiesQuery.isError && !taxonomiesQuery.isPending)

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <h1 className="font-heading text-base leading-snug font-medium">Form builder</h1>
        </CardHeader>
        <CardContent className="grid gap-6">
          <PageList
            pages={draft.content.pages}
            elements={draft.content.elements}
            invalidElementId={null}
            onUpdateElement={updateElement}
            onMoveElement={moveElement}
            registerLabelRef={registerLabelRef}
          />
          <ConditionRuleEditor
            rules={draft.content.conditionRules}
            elements={draft.content.elements}
            registerValueRef={registerValueRef}
            onUpdateRule={updateConditionRule}
          />
          <RoutingRuleEditor
            rules={draft.content.routingRules}
            taxonomyItems={taxonomyItems}
            taxonomyUnavailable={taxonomyUnavailable}
            onUpdateRule={updateRoutingRule}
          />
          {taxonomyUnavailable ? (
            <AlertLive>
              Taxonomy unavailable — open the builder from an event page to choose routing targets.
            </AlertLive>
          ) : null}
          {validationMessage !== null ? <AlertLive>{validationMessage}</AlertLive> : null}
          {saveError !== null ? (
            saveError.kind === 'forbidden' ? (
              <AlertLive>Access forbidden.</AlertLive>
            ) : saveError.kind === 'denied' ? (
              <AlertLive>Not found.</AlertLive>
            ) : saveError.kind === 'expired' ? (
              <AlertLive>Your session has expired. Sign in again to continue.</AlertLive>
            ) : (
              <AlertLive>{saveError.message}</AlertLive>
            )
          ) : null}
          {conflictScope !== null ? (
            <div className="grid gap-2 rounded-lg border border-destructive p-3">
              <AlertLive>The draft changed elsewhere — reload to see the latest</AlertLive>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void reloadLatest()}
                >
                  Reload latest
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={discardChanges}>
                  Discard my changes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={retryPending}
                  onClick={() => void retryAfterReload()}
                >
                  Retry after reload
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                ref={previewButtonRef}
                onClick={() => setPreviewOpen(true)}
              >
                Preview
              </Button>
              <Button type="button" variant="outline" onClick={() => setPublishOpen(true)}>
                Publish
              </Button>
              <Button
                type="button"
                disabled={save.isPending}
                aria-label={save.isPending ? 'Saving…' : 'Save'}
                onClick={saveDraft}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
            {statusMessage !== null ? <StatusLive>{statusMessage}</StatusLive> : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
        </CardHeader>
        <CardContent>
          {versionsQuery.data !== undefined && versionsQuery.data.length > 0 ? (
            <ul className="grid gap-2">
              {versionsQuery.data.map((version) => (
                <li key={version.id} className="flex items-center justify-between gap-3">
                  <Link
                    to="/admin/forms/$formId/versions/$versionId"
                    params={{ formId: formId ?? '', versionId: version.id }}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Version {version.version}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {version.status === 'published' ? 'Published' : 'Draft'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          )}
        </CardContent>
      </Card>
      <PreviewDialog
        open={previewOpen}
        draft={draft}
        taxonomyItems={taxonomyItems}
        onClose={closePreview}
      />
      <PublishConfirmDialog
        open={publishOpen}
        version={draft.meta.version}
        pending={publish.isPending}
        onConfirm={confirmPublish}
        onCancel={() => setPublishOpen(false)}
      />
      {blocker.status === 'blocked' ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) blocker.reset()
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Unsaved changes</DialogTitle>
              <DialogDescription>
                Your changes have not been saved. Leave this page and discard them?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => blocker.reset()}>
                Stay
              </Button>
              <Button type="button" onClick={() => blocker.proceed()}>
                Leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
