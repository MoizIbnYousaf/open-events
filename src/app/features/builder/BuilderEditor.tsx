import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from '@tanstack/react-router'

import AppShell from '../nav/AppShell'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { FormVersionSummaryDto, SaveFormDraftInput } from '../../../application'
import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import {
  adminFormQueryKeys,
  useFormDraft,
  useFormVersionDetail,
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
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { EmptyState } from '../../../components/ui/empty-state'
import { DocumentIcon, DocumentStackIcon } from '../../../components/ui/icons'
import { linkVariants } from '../../../components/ui/link-variants'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import {
  conditionValueKey,
  addQuestionToDraft,
  dtoToBuilderDraft,
  moveElementInDraft,
  rebindDraft,
  toSaveInput,
  validateBuilderContent,
  type BuilderDraft,
  type BuilderValidationIssue,
} from './builder-model'
import ConditionRuleEditor from './ConditionRuleEditor'
import PageList from './PageList'
import PreviewDialog from './PreviewDialog'
import PublishConfirmDialog from './PublishConfirmDialog'
import RoutingRuleEditor from './RoutingRuleEditor'

const PreviewEngine = lazy(() => import('./preview-engine'))

export default function BuilderEditor() {
  return <BuilderEditorByForm />
}

function BuilderEditorByForm() {
  const params = useParams({ strict: false })
  const formId = params.formId as string | undefined
  const eventSlug = params.slug as string | undefined
  // Keying the screen by formId resets all form-scoped local state on a route
  // form-id change, so a new form can never inherit prior-form content.
  return <BuilderEditorScreen key={formId ?? 'no-form'} formId={formId} eventSlug={eventSlug} />
}

/**
 * The body that starts a draft on a form that has never had one. The save
 * route builds the version row itself; the content it stores is whatever
 * arrives, and an empty form is the honest starting point for one that has
 * nothing published to copy.
 */
const EMPTY_DRAFT_INPUT: SaveFormDraftInput = {
  pages: [],
  elements: [],
  conditionRules: [],
  routingRules: [],
}

/**
 * The version history, which loads and reads the same whether or not the form
 * has a draft — so the no-draft screen shows it too rather than sending the
 * operator to a page with nothing on it. Extracted because it is now rendered
 * from two states, not because it is a reusable widget.
 */
function VersionsCard({
  versions,
  eventSlug,
  formId,
}: {
  readonly versions: readonly FormVersionSummaryDto[] | undefined
  readonly eventSlug: string | undefined
  readonly formId: string | undefined
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Versions</CardTitle>
      </CardHeader>
      <CardContent>
        {versions !== undefined && versions.length > 0 ? (
          <ul className="-my-1 divide-y divide-border">
            {versions.map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-3 py-1.5">
                <Link
                  to="/admin/events/$slug/forms/$formId/versions/$versionId"
                  params={{
                    slug: eventSlug ?? '',
                    formId: formId ?? '',
                    versionId: version.id,
                  }}
                  className={linkVariants({ hit: true, className: 'text-sm' })}
                >
                  Version {version.version}
                </Link>
                {/* Published or draft is the version's lifecycle state. */}
                <Badge dot variant={version.status === 'published' ? 'secondary' : 'outline'}>
                  {version.status === 'published' ? 'Published' : 'Draft'}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<DocumentStackIcon size={20} />}
            title="Publish your first version"
            description="Publishing freezes the draft as a numbered version and opens it to speakers."
          />
        )}
      </CardContent>
    </Card>
  )
}

type SaveErrorState =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'error'; readonly message: string }

function BuilderEditorScreen({
  formId,
  eventSlug,
}: {
  readonly formId: string | undefined
  readonly eventSlug: string | undefined
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const draftQuery = useFormDraft(eventSlug, formId)
  const versionsQuery = useFormVersions(eventSlug, formId)
  const taxonomiesQuery = useTaxonomies(eventSlug)
  const save = useUpdateFormDraft(eventSlug ?? '', formId ?? '')
  const publish = usePublishForm(eventSlug ?? '', formId ?? '')

  const queryDraft = useMemo(
    () =>
      draftQuery.data === undefined || draftQuery.data === null
        ? null
        : dtoToBuilderDraft(draftQuery.data),
    [draftQuery.data],
  )
  // Only fetched in the one state that needs it: a form with no draft, where
  // the frozen published version is what a new draft is forked from. With a
  // draft on the page the version id is undefined and the query never runs.
  const latestPublished =
    (versionsQuery.data ?? [])
      .filter((version) => version.status === 'published')
      .sort((left, right) => right.version - left.version)
      .at(0) ?? null
  const forkSourceQuery = useFormVersionDetail(
    eventSlug,
    formId,
    draftQuery.data === null ? latestPublished?.id : undefined,
  )
  const forkPending = latestPublished !== null && forkSourceQuery.data === undefined
  const [draftOverride, setDraftOverride] = useState<BuilderDraft | null>(null)
  const draft = draftOverride ?? queryDraft
  const setDraft = useCallback(
    (next: BuilderDraft | null | ((current: BuilderDraft | null) => BuilderDraft | null)) => {
      setDraftOverride((current) =>
        typeof next === 'function' ? next(current ?? queryDraft) : next,
      )
    },
    [queryDraft],
  )
  const [dirty, setDirty] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  // Retained (not discarded) so the precise field carries the message: the
  // summary sentence alone highlighted nothing, because invalidElementId was a
  // hardcoded null and the condition rows rendered no error node at all.
  const [validationIssue, setValidationIssue] = useState<BuilderValidationIssue | null>(null)
  const [saveError, setSaveError] = useState<SaveErrorState | null>(null)
  const [conflictScope, setConflictScope] = useState<'save' | 'publish' | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [retryPending, setRetryPending] = useState(false)
  const [reloadPending, setReloadPending] = useState(false)
  const dirtyRef = useRef(false)
  const retryInFlightRef = useRef(false)
  const reloadInFlightRef = useRef(false)
  const previewButtonRef = useRef<HTMLButtonElement | null>(null)
  const labelRefs = useRef(new Map<string, HTMLInputElement | null>())
  const valueRefs = useRef(new Map<string, HTMLInputElement | null>())
  const attemptedSaveRef = useRef<SaveFormDraftInput | null>(null)

  // A form that really is not there renders the Not found page state, and the
  // tab said "Form builder" over it — the one place the reader is told which
  // page they are on when the page is not on screen. Both routes to the state
  // are the same question: the draft read answered 404, or there was no draft
  // and the versions read answered 404 too (a form with only a published
  // version is NOT missing; it forks a new draft).
  const notFound =
    (draftQuery.isError && draft === null && getApiErrorCode(draftQuery.error) === 'not_found') ||
    (draft === null &&
      draftQuery.data === null &&
      !versionsQuery.isPending &&
      getApiErrorCode(versionsQuery.error) === 'not_found')

  // The same question one answer further along: a refused read renders
  // ExpiredSessionState below, and the tab went on saying "Form builder" over
  // a page the reader was refused. `notFound` keys on `not_found` codes only,
  // so a 401 fell to the else branch. /agenda, /evaluations and /readiness
  // already title their expired state; this route was simply not in that set,
  // which left the product answering one moment two ways.
  const expired =
    draftQuery.isError && draft === null && getApiErrorCode(draftQuery.error) === 'unauthorized'

  useEffect(() => {
    document.title = notFound
      ? 'Not found — Open Events'
      : expired
        ? 'Session expired — Open Events'
        : 'Form builder — Open Events'
  }, [notFound, expired])

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
    // The status region below already carries this sentence; announcing it as
    // well would speak the move twice (DEC-014).
    setStatusMessage(`Moved to position ${result.pageIndex}`)
  }

  const addQuestion = (pageId: string) => {
    setDraft((current) => (current === null ? current : addQuestionToDraft(current, pageId, 'short_text')))
    setDirty(true)
    dirtyRef.current = true
    setStatusMessage('Question added')
  }

  const saveDraft = () => {
    if (draft === null || formId === undefined) return
    setStatusMessage(null)
    setSaveError(null)
    setConflictScope(null)
    const issue = validateBuilderContent(draft.content)
    if (issue !== null) {
      setValidationMessage('Please fix the highlighted fields.')
      setValidationIssue(issue)
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
    setValidationIssue(null)
    performSave(toSaveInput(draft))
  }

  /**
   * Forking the published version into a new draft is the same write as any
   * other save — the route creates the draft version when none exists — so it
   * goes through the same path rather than inventing a second one. Only the
   * sentence the operator reads differs, because "Saved" is not what just
   * happened when there was nothing to save.
   */
  const startDraft = () => {
    if (formId === undefined || forkPending) return
    const source = forkSourceQuery.data
    setStatusMessage(null)
    setSaveError(null)
    setConflictScope(null)
    performSave(source === undefined ? EMPTY_DRAFT_INPUT : toSaveInput(dtoToBuilderDraft(source)), {
      started: true,
    })
  }

  const performSave = (input: SaveFormDraftInput, options: { started?: boolean } = {}) => {
    if (formId === undefined) return
    attemptedSaveRef.current = input
    save.mutate(input, {
      onSuccess: (updated) => {
        attemptedSaveRef.current = null
        const rebound = rebindDraft(updated, input)
        setDraft(rebound)
        setDirty(false)
        dirtyRef.current = false
        // The builder's own StatusLive renders this string and is a live
        // region, so the announcer would speak one outcome twice (DEC-014,
        // F-R3-13).
        setStatusMessage(options.started === true ? 'Draft started' : 'Saved')
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
        // A toast: publishing is a terminal act and the organizer leaves for
        // the version page or the public form straight after. The "Published"
        // chip and the version list are still the durable record (DEC-019).
        toast.success(`Version ${draft?.meta.version ?? ''} published`.trim())
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
    // Synchronous reentrancy guard, matching retryAfterReload: closes the
    // same-tick double-click gap before any state update can render.
    if (reloadInFlightRef.current) return
    reloadInFlightRef.current = true
    setReloadPending(true)
    try {
      const result = await draftQuery.refetch()
      if (result.isError || result.data === undefined || result.data === null) {
        return
      }
      attemptedSaveRef.current = null
      setConflictScope(null)
      setDraft(dtoToBuilderDraft(result.data))
      setDirty(false)
      dirtyRef.current = false
    } finally {
      reloadInFlightRef.current = false
      setReloadPending(false)
    }
  }

  const discardChanges = () => {
    if (draftQuery.data === undefined || draftQuery.data === null) return
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
      if (result.isError || result.data === undefined || result.data === null) {
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
        pending={draftQuery.isFetching}
        onRetry={() => void draftQuery.refetch()}
      />
    )
  }

  // No draft is a state, not a failure. The route answers 404 for a form whose
  // only version is published — the shape the seeded demo ships in — and for a
  // form that does not exist at all. The versions read the page already makes
  // separates them: a form that is really missing fails that one too.
  if (draft === null && draftQuery.data === null && !versionsQuery.isPending) {
    if (getApiErrorCode(versionsQuery.error) === 'not_found') return <DeniedState />
    return (
      <AppShell slug={eventSlug ?? ''}>
        <div className="grid gap-4">
          <PageHeader>
            <PageHeaderContent>
              <PageHeaderTitle>Form builder</PageHeaderTitle>
            </PageHeaderContent>
          </PageHeader>
          <StatusLive aria-live="polite">
            {save.isPending ? 'Starting the form draft…' : statusMessage}
          </StatusLive>
          <EmptyState
            icon={<DocumentIcon size={20} />}
            title="Start a new draft"
            description={
              latestPublished === null
                ? 'This form has nothing to edit yet. Starting a draft opens the builder on an empty form.'
                : `Version ${latestPublished.version} is published and frozen. Starting a draft copies it into a new version you can edit.`
            }
          >
            <Button
              type="button"
              size="sm"
              pending={forkPending || save.isPending}
              onClick={startDraft}
            >
              {save.isPending ? 'Starting…' : 'Start a new draft'}
            </Button>
          </EmptyState>
          {saveError !== null ? (
            <AlertLive>
              {saveError.kind === 'forbidden'
                ? 'Access forbidden.'
                : saveError.kind === 'denied'
                  ? 'Not found.'
                  : saveError.kind === 'expired'
                    ? 'Your session has expired. Sign in again to continue.'
                    : saveError.message}
            </AlertLive>
          ) : null}
          <VersionsCard versions={versionsQuery.data} eventSlug={eventSlug} formId={formId} />
        </div>
      </AppShell>
    )
  }

  if (draft === null) {
    return (
      <AppShell slug={eventSlug ?? ''}>
        <Card aria-busy="true" aria-label="Loading form builder">
          <CardContent className="grid gap-2.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-8 w-1/2" />
            <StatusLive aria-live="polite">Loading the form builder…</StatusLive>
          </CardContent>
        </Card>
      </AppShell>
    )
  }

  const taxonomyItems = taxonomiesQuery.data?.items ?? []
  const taxonomyUnavailable =
    eventSlug === undefined || (taxonomiesQuery.isError && !taxonomiesQuery.isPending)

  return (
    <AppShell slug={eventSlug ?? ''}>
      <div className="grid gap-4">
        {/* The title, the dirty state and the three verbs that act on the
            draft live in one strip, so the operator never has to scroll to the
            bottom of a long form to find Save. */}
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Form builder</PageHeaderTitle>
          </PageHeaderContent>
          <PageHeaderActions>
            {/* An annotation on the editor, not a state the form is in: it
                describes this browser tab, and it disappears the moment the
                draft is saved. The quietest face, and no state marker. */}
            {dirty ? <Badge variant="ghost">Unsaved changes</Badge> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              ref={previewButtonRef}
              onClick={() => setPreviewOpen(true)}
            >
              Preview
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPublishOpen(true)}>
              Publish
            </Button>
            <Button type="button" size="sm" pending={save.isPending} onClick={saveDraft}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </PageHeaderActions>
        </PageHeader>
        {/* One stable region for both, mounted before either has anything to
            say: a live region created together with its text is not in the
            accessibility tree when the text arrives, so it announces nothing.
            The in-flight message replaces the status chip on the way out and
            gives it back on settle. */}
        <StatusLive aria-live="polite">
          {save.isPending ? 'Saving the form draft…' : statusMessage}
        </StatusLive>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
          <div className="grid gap-4">
          <PageList
            pages={draft.content.pages}
            elements={draft.content.elements}
            invalidElementId={validationIssue?.kind === 'label' ? validationIssue.elementId : null}
            onUpdateElement={updateElement}
            onMoveElement={moveElement}
            onAddQuestion={addQuestion}
            registerLabelRef={registerLabelRef}
          />
          <ConditionRuleEditor
            rules={draft.content.conditionRules}
            elements={draft.content.elements}
            invalidConditionKey={
              validationIssue?.kind === 'condition-value'
                ? conditionValueKey(
                    validationIssue.ruleId,
                    validationIssue.groupIndex,
                    validationIssue.conditionIndex,
                  )
                : null
            }
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
            // A recovery card, not a red box: the three ways out are the
            // point, so they get the room. Every one of them is offered
            // because none of them is safe to pick for the operator.
            <div className="grid gap-3 rounded-lg bg-destructive/5 p-3 ring-1 ring-destructive/40">
              <AlertLive className="border-l-0 pl-0 font-medium">
                The draft changed elsewhere — reload to see the latest
              </AlertLive>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  pending={reloadPending}
                  onClick={() => void reloadLatest()}
                >
                  {reloadPending ? 'Reloading…' : 'Reload latest'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDiscardOpen(true)}
                >
                  Discard my changes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  pending={retryPending}
                  onClick={() => void retryAfterReload()}
                >
                  {retryPending ? 'Trying again…' : 'Retry after reload'}
                </Button>
              </div>
            </div>
          ) : null}
          </div>
          <aside
            data-slot="builder-live-preview"
            aria-label="What speakers see"
            className="grid gap-2 xl:sticky xl:top-16"
          >
            <p className="text-xs font-medium text-muted-foreground">What speakers see</p>
            <Suspense fallback={<StatusLive>Loading the live preview…</StatusLive>}>
              <PreviewEngine content={draft.content} taxonomyItems={taxonomyItems} />
            </Suspense>
          </aside>
        </div>
        <VersionsCard versions={versionsQuery.data} eventSlug={eventSlug} formId={formId} />
        {/* The one control on this page that destroys work with no way back,
            offered at the exact moment the operator's edits are most valuable:
            a 409 means the draft they are holding is the only copy of what
            they typed. So it asks, and the question names what goes. */}
        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title="Discard your changes"
          description="Your unsaved edits to this draft are thrown away and the version saved elsewhere takes their place. This cannot be undone."
          // Deliberately NOT the trigger's words. The house rule everywhere
          // else in the product is that the control which opens the question
          // and the control which answers it carry different names — so a
          // click can never land on the wrong one, and a strict selector can
          // never match two things at once.
          confirmLabel="Discard them"
          onConfirm={() => {
            discardChanges()
            setDiscardOpen(false)
          }}
        />
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
              {/* Same ladder as every other irreversible step: the quiet way
                  back sits first, and the button that throws the edits away
                  carries the destructive weight. Copy and blocker wiring are
                  unchanged. */}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => blocker.reset()}>
                  Stay
                </Button>
                <Button type="button" variant="destructive" onClick={() => blocker.proceed()}>
                  Leave
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </AppShell>
  )
}
