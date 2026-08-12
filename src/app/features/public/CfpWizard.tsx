import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import type { FormDefinitionDto } from '../../../application'
import type { AnswerValue, ElementFieldKey } from '../../../domain'
import { isElementRequiredDto, isElementVisibleDto } from '../../lib/form-engine'
import { getApiErrorCode } from '../../api/admin-events'
import {
  ExpiredSessionState,
  ForbiddenState,
  LoadErrorState,
  PageState,
  PaletteHint,
} from '../admin/AdminStates'
import { buttonVariants } from '../../../components/ui/button-variants'
import { Card, CardContent } from '../../../components/ui/card'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { StatusLive } from '../../../components/ui/status-live'
import {
  clearCfpDraftStash,
  publicDraftQueryKeys,
  readCfpDraftStash,
  recoverPublicSession,
  stashCfpDraft,
  useActiveDraft,
  usePublicEditor,
  type PublicEditorState,
} from '../../queries/public-drafts'
import CfpCoSpeakers from './CfpCoSpeakers'
import { CfpFieldLabelRow } from './CfpFields'
import CfpReviewSummary from './CfpReviewSummary'
import CfpSaveBar, { type SaveDenial } from './CfpSaveBar'
import CfpSubmit from './CfpSubmit'
import CfpStepper from './CfpStepper'
import CfpStepRenderer from './CfpStepRenderer'

interface CfpWizardProps {
  readonly form: FormDefinitionDto
  readonly eventSlug: string
  readonly formSlug: string
}

/** Proposal title is a universal property, not a form question; see SubmitInput. */
const TITLE_FIELD_KEY = 'title'
const TITLE_REQUIRED_MESSAGE = 'Proposal title is required'

function isEmptyAnswer(value: AnswerValue | null | undefined): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function defaultEditor(formId: string, formVersionId: string): PublicEditorState {
  return {
    formId,
    formVersionId,
    draftId: null,
    title: '',
    answers: {},
    dirty: false,
    reloadIntent: false,
    coSpeakers: [],
  }
}

export default function CfpWizard({ form }: CfpWizardProps) {
  const queryClient = useQueryClient()
  const router = useRouter({ warn: false })
  const steps = useMemo(() => form.pages.toSorted((a, b) => a.position - b.position), [form.pages])
  const proposalPageIndex = useMemo(() => steps.findIndex((page) => page.kind === 'info'), [steps])
  const hasTitleQuestion = useMemo(
    () => form.elements.some((element) => element.fieldKey === TITLE_FIELD_KEY),
    [form],
  )
  const draftQuery = useActiveDraft(form.formId)
  const editorQuery = usePublicEditor(form.formId, form.versionId)
  const editor = editorQuery.data ?? defaultEditor(form.formId, form.versionId)
  const answers = editor.answers
  const dirty = editor.dirty

  const [stepIndex, setStepIndex] = useState(0)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  // The title the speaker is typing RIGHT NOW, ahead of the shared editor
  // cache. A TanStack cache write reaches this component a task later, so a
  // controlled input reading straight from the cache re-rendered every
  // keystroke with the previous value: React reset the DOM value and threw the
  // caret to the end, and a typo in the middle of a proposal title could not be
  // be fixed. The buffer is stamped with the draft revision it was typed
  // against, so the moment the server answers with a newer one — a reload after
  // a conflict — the keystroke buffer is stale by construction and the
  // hydrated title wins. No effect, no reset, nothing to keep in sync.
  const [titleBuffer, setTitleBuffer] = useState<{
    readonly revision: number
    readonly value: string
  } | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  /** A save refused for who the reader is; the page owes it one whole answer. */
  const [saveDenial, setSaveDenial] = useState<SaveDenial | null>(null)
  const fieldRefs = useRef(new Map<ElementFieldKey, HTMLElement | null>())
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const lastChangedRef = useRef<ElementFieldKey | null>(null)
  const lastFocusedElementRef = useRef<HTMLElement | null>(null)
  const prevVisibleRef = useRef<ReadonlySet<ElementFieldKey>>(new Set())
  const previousStepRef = useRef(stepIndex)
  /** A parked draft is restored at most once, into an untouched editor. */
  const restoredParkedRef = useRef(false)

  /**
   * Park everything typed so the identity detour is a resumption, not a
   * retype. A refused save replaces the wizard with one honest page state and
   * the visitor leaves for /start; the editor lives in memory and dies with
   * that navigation, so the words have to outlive it somewhere.
   */
  const parkDraft = useCallback(() => {
    const editor = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
    if (editor === undefined) return
    stashCfpDraft(form.versionId, {
      title: editor.title,
      answers: editor.answers,
      stepIndex,
    })
  }, [form.versionId, queryClient, stepIndex])

  const setEditor = useCallback(
    (updater: (current: PublicEditorState) => PublicEditorState) => {
      queryClient.setQueryData<PublicEditorState>(publicDraftQueryKeys.editor, (current) => {
        if (current === undefined) {
          throw new Error('Editor state is not initialized')
        }
        return updater(current)
      })
    },
    [queryClient],
  )

  const currentPage = steps[stepIndex]
  const stepElements = useMemo(
    () =>
      currentPage === undefined
        ? []
        : form.elements.filter((element) => element.pageId === currentPage.id),
    [form, currentPage],
  )
  const visibleElements = useMemo(
    () =>
      stepElements.filter(
        (element): element is (typeof stepElements)[number] & { fieldKey: ElementFieldKey } =>
          element.fieldKey !== null && isElementVisibleDto(element, form.conditionRules, answers),
      ),
    [stepElements, form.conditionRules, answers],
  )
  const visibleFields = useMemo(
    () => visibleElements.map((element) => element.fieldKey),
    [visibleElements],
  )
  /** True where the wizard renders its own title field, above the questions. */
  const showTitleField = stepIndex === proposalPageIndex && !hasTitleQuestion
  const domIds = useMemo(() => {
    const map: Record<string, string> = {}
    stepElements.forEach((element, index) => {
      if (element.fieldKey !== null) {
        map[element.fieldKey] = `cfp-${currentPage?.position ?? 0}-${index}`
      }
    })
    return map
  }, [stepElements, currentPage])
  const ariaControls = useMemo(() => {
    const map: Record<string, string | undefined> = {}
    const stepElementsById = new Map(stepElements.map((element) => [element.id, element]))
    for (const element of stepElements) {
      if (element.fieldKey === null) continue
      const targets = new Set<string>()
      for (const rule of form.conditionRules) {
        if (rule.effect !== 'show') continue
        const controlsThisField = rule.groups.some((group) =>
          group.conditions.some((condition) => condition.operandKey === element.fieldKey),
        )
        if (!controlsThisField) continue
        const target = stepElementsById.get(rule.elementId)
        if (target?.fieldKey !== null && target?.fieldKey !== undefined) {
          const targetId = domIds[target.fieldKey]
          if (targetId !== undefined) targets.add(targetId)
        }
      }
      if (targets.size > 0) {
        map[element.fieldKey] = [...targets].join(' ')
      }
    }
    return map
  }, [stepElements, form.conditionRules, domIds])

  // Hydration: write the draft id/title/answers into the shared editor cache
  // when the draft query data changes (initial load, reload). Hydrated server
  // state clears dirty; no focus call is made.
  useEffect(() => {
    // A visitor with no session gets the draft probe REFUSED, not answered. A
    // refusal carries exactly as much server truth as an answered probe that
    // found nothing — there is no draft — so it joins the same path rather
    // than forking into a second restore. What it must never do is reach the
    // hydration write at the bottom: a refusal is not permission to declare
    // the editor empty and clean.
    const probeRefused = draftQuery.isError
    if (!probeRefused && draftQuery.data === undefined) return
    const draft = probeRefused ? null : (draftQuery.data ?? null)
    const editorBefore = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
    const reloadArmed = !probeRefused && editorBefore?.reloadIntent === true
    // Hydration is server truth arriving at a resting editor: the first probe,
    // and the deliberate reload after a conflict (which is meant to discard
    // local edits, so it runs regardless). It must never run over words typed
    // since — a save acknowledgement writes this cache too, and what it
    // acknowledges is by definition older than anything typed while the
    // request was in flight.
    if (!reloadArmed && editorBefore?.dirty === true) return
    // Nothing on the server and something parked before the identity detour:
    // the visitor is coming back to work they already did, so restore it
    // rather than greeting them with an empty form.
    // Once, and only into an editor nobody has typed into yet: restoring on
    // every hydration would yank a working visitor back to the step they were
    // on when they left, and a save acknowledgement hydrates too.
    const editorIsPristine =
      editorBefore === undefined ||
      (editorBefore.title === '' && Object.keys(editorBefore.answers).length === 0)
    const parked =
      draft === null && !restoredParkedRef.current && editorIsPristine
        ? readCfpDraftStash(form.versionId)
        : null
    if (parked !== null && !reloadArmed) {
      restoredParkedRef.current = true
      setEditor((current) => ({
        ...current,
        formId: form.formId,
        formVersionId: form.versionId,
        draftId: null,
        title: parked.title,
        answers: parked.answers,
        dirty: true,
        reloadIntent: false,
      }))
      setStepIndex(parked.stepIndex)
      return
    }
    // Nothing was parked, and a refusal told us nothing about the server. Leave
    // the editor exactly as the visitor left it.
    if (probeRefused) return
    // The server holds it now, so the parked copy has done its job.
    if (draft !== null) clearCfpDraftStash(form.versionId)
    setEditor((current) => ({
      ...current,
      formId: form.formId,
      formVersionId: form.versionId,
      draftId: draft?.id ?? null,
      title: draft?.title ?? '',
      answers: draft?.answers ?? {},
      dirty: false,
      reloadIntent: false,
    }))
    // A reload (armed reload intent) restores focus to the deterministic
    // user-focused field at the query-completion boundary; the intent is
    // cleared. Initial load and save-success never steal focus.
    if (reloadArmed) {
      const element = lastFocusedElementRef.current
      if (element !== null && element.isConnected) {
        element.focus()
      }
    }
  }, [draftQuery.data, draftQuery.isError, form.formId, form.versionId, setEditor, queryClient])

  // Track the deterministic user-focused field element via focusin.
  useEffect(() => {
    const handler = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.isConnected && target.id.startsWith('cfp-')) {
        lastFocusedElementRef.current = target
      }
    }
    document.addEventListener('focusin', handler)
    return () => document.removeEventListener('focusin', handler)
  }, [])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // Step change: reset the visibility baseline and focus the first field.
  // "First" means first in the DOM, and the built-in proposal title is a field
  // like any other: it used to be left out of the candidate list, so arriving
  // on the proposal step skipped straight past the first question on the page.
  useEffect(() => {
    if (previousStepRef.current === stepIndex) return
    previousStepRef.current = stepIndex
    prevVisibleRef.current = new Set(visibleFields)
    if (showTitleField && titleInputRef.current !== null) {
      titleInputRef.current.focus()
      return
    }
    const first = visibleFields[0]
    if (first !== undefined) {
      fieldRefs.current.get(first)?.focus()
    }
  }, [stepIndex, visibleFields, showTitleField])

  // Reveal/hide: clear EVERY newly hidden answer; focus and announce the first
  // revealed field; otherwise return focus to the triggering control.
  useEffect(() => {
    const previous = prevVisibleRef.current
    const next = new Set(visibleFields)
    const hiddenFields = [...previous].filter((fieldKey) => !next.has(fieldKey))
    const revealedFields = visibleFields.filter((fieldKey) => !previous.has(fieldKey))
    if (hiddenFields.length > 0) {
      setEditor((current) => {
        const nextAnswers = { ...current.answers }
        for (const fieldKey of hiddenFields) {
          delete nextAnswers[fieldKey]
        }
        return { ...current, answers: nextAnswers }
      })
    }
    if (revealedFields.length > 0) {
      const firstRevealed = revealedFields[0]
      if (firstRevealed !== undefined) {
        const element = stepElements.find((candidate) => candidate.fieldKey === firstRevealed)
        setAnnouncement(`${element?.label ?? 'Question'} shown`)
        fieldRefs.current.get(firstRevealed)?.focus()
      }
    } else if (hiddenFields.length > 0) {
      const trigger = lastChangedRef.current
      if (trigger !== null) {
        fieldRefs.current.get(trigger)?.focus()
      }
    }
    prevVisibleRef.current = next
  }, [visibleFields, stepElements, setEditor])

  const registerFieldRef = (fieldKey: ElementFieldKey) => (node: HTMLElement | null) => {
    if (node === null) {
      fieldRefs.current.delete(fieldKey)
    } else {
      fieldRefs.current.set(fieldKey, node)
    }
  }

  const handleChange = (fieldKey: ElementFieldKey, value: unknown) => {
    lastChangedRef.current = fieldKey
    setEditor((current) => ({
      ...current,
      answers: { ...current.answers, [fieldKey]: value as AnswerValue | null },
      // Forms that ask for a title as a question keep editor.title in sync so
      // save/submit always carry the proposal title.
      ...(fieldKey === TITLE_FIELD_KEY ? { title: typeof value === 'string' ? value : '' } : {}),
      dirty: true,
    }))
  }

  const validateStep = (): boolean => {
    // Collected in DOM order, because the reader is sent to `issues[0]` and
    // "the first problem" has to mean the first one on the page. Element issues
    // used to be gathered first and the title's appended after, so any step
    // where a question also failed sent focus straight past the title error
    // sitting above it.
    const issues: { readonly fieldKey: ElementFieldKey; readonly message: string }[] = []
    const titleQuestionOnStep = stepElements.some((element) => element.fieldKey === TITLE_FIELD_KEY)
    const titleIsRequired = showTitleField || titleQuestionOnStep
    const titleMissing = titleIsRequired && editor.title.trim().length === 0
    if (showTitleField && titleMissing) {
      issues.push({ fieldKey: TITLE_FIELD_KEY, message: TITLE_REQUIRED_MESSAGE })
    }
    for (const element of stepElements) {
      if (element.fieldKey === null) continue
      if (!isElementVisibleDto(element, form.conditionRules, answers)) continue
      if (element.fieldKey === TITLE_FIELD_KEY) {
        if (titleMissing) {
          issues.push({ fieldKey: TITLE_FIELD_KEY, message: TITLE_REQUIRED_MESSAGE })
        }
        continue
      }
      if (
        isElementRequiredDto(element, form.conditionRules, answers) &&
        isEmptyAnswer(answers[element.fieldKey])
      ) {
        issues.push({ fieldKey: element.fieldKey, message: 'This field is required' })
      }
    }
    // A title question hidden by a condition still owes the submission a title,
    // so the requirement survives even when no control on the step carries it.
    if (titleMissing && !issues.some((issue) => issue.fieldKey === TITLE_FIELD_KEY)) {
      issues.push({ fieldKey: TITLE_FIELD_KEY, message: TITLE_REQUIRED_MESSAGE })
    }
    if (issues.length > 0) {
      const nextErrors: Record<string, string> = {}
      for (const issue of issues) {
        nextErrors[issue.fieldKey] = issue.message
      }
      setErrors(nextErrors)
      const first = issues[0]
      if (first !== undefined) {
        if (first.fieldKey === TITLE_FIELD_KEY && titleInputRef.current !== null) {
          titleInputRef.current.focus()
        } else {
          fieldRefs.current.get(first.fieldKey)?.focus()
        }
      }
      return false
    }
    setErrors({})
    return true
  }

  const handleNext = () => {
    if (validateStep()) {
      setErrors({})
      setStepIndex((index) => index + 1)
    }
  }

  const handleBack = () => {
    setErrors({})
    setStepIndex((index) => Math.max(0, index - 1))
  }

  if (draftQuery.isError) {
    const code = getApiErrorCode(draftQuery.error)
    // The draft probe is OPTIONAL — it asks "is there a proposal to resume?".
    // A refusal on the FIRST ask is the reader having no speaker session at
    // all: a first-time visitor, or an organizer following their own public
    // link. The honest answer to the question asked is "no draft", so the call
    // for papers renders. It used to replace the judged public page with
    // "Session expired" for a visitor who had never had a session, and with a
    // bare "Access forbidden" card for the organizer.
    //
    // A refusal on a LATER ask is different in kind: the probe answered once,
    // so there WAS a session and it has since died mid-draft. That reader is
    // in the middle of a proposal and gets the recovery path, unchanged.
    const deniedProbe = code === 'unauthorized' || code === 'forbidden'
    if (!deniedProbe || draftQuery.isRefetchError) {
      if (code === 'unauthorized') {
        return (
          <ExpiredSessionState
            onLogin={() => recoverPublicSession(queryClient, form.formId, router)}
          />
        )
      }
      if (code === 'forbidden') {
        return <ForbiddenState />
      }
      // A load failure used to end here: a sentence and nothing to press. The
      // draft is a GET, so offering the reader the retry costs nothing and is
      // the difference between a stalled proposal and a second attempt.
      return (
        <div className="mx-auto w-full max-w-[47rem]">
          <LoadErrorState
            message="Unable to load your draft."
            pending={draftQuery.isFetching}
            onRetry={() => void draftQuery.refetch()}
          />
        </div>
      )
    }
  }

  // A refused SAVE replaces the page, exactly once. The save bar used to render
  // a page state into its own slot: a second dead-end card and a second h1
  // below a wizard that was still editable and could no longer save anything.
  if (saveDenial === 'forbidden') {
    return <OrganizerCannotSaveState />
  }
  if (saveDenial === 'unauthorized') {
    // "Expired" is only honest for a reader who had a session to lose. The
    // draft probe is session-guarded, so an answer of any kind — a draft, or
    // the 404 that maps to null — proves there was one, and a refusal proves
    // there was not. A first-time visitor was being told their session had
    // expired when they had never had one.
    return draftQuery.isSuccess ? (
      <ExpiredSessionState onLogin={() => recoverPublicSession(queryClient, form.formId, router)} />
    ) : (
      <IdentifyToSaveState />
    )
  }

  if (currentPage === undefined) return null

  const confirmationActive = submitted && currentPage.kind === 'submit'

  // A proposal is prose, so the wizard is a reading column rather than a
  // full-bleed form: the measure is what keeps a long abstract legible.
  return (
    <div className="mx-auto grid w-full max-w-[47rem] gap-5">
      {confirmationActive ? null : (
        <>
          <PageHeader>
            <PageHeaderContent>
              <PageHeaderTitle>Call for papers</PageHeaderTitle>
              <PageHeaderDescription>
                Step {stepIndex + 1} of {steps.length} — {currentPage.title}
              </PageHeaderDescription>
            </PageHeaderContent>
          </PageHeader>
          <CfpStepper steps={steps} currentIndex={stepIndex} />
          <Card>
            <CardContent>
              <CfpStepRenderer
                page={currentPage}
                elements={stepElements}
                conditionRules={form.conditionRules}
                answers={answers}
                errors={errors}
                domIds={domIds}
                ariaControls={ariaControls}
                registerFieldRef={registerFieldRef}
                onChange={handleChange}
              >
                {showTitleField ? (
                  <Field invalid={errors.title !== undefined}>
                    <CfpFieldLabelRow required>
                      <FieldLabel htmlFor="cfp-proposal-title">Proposal title</FieldLabel>
                    </CfpFieldLabelRow>
                    <Input
                      id="cfp-proposal-title"
                      ref={titleInputRef}
                      required
                      value={
                        titleBuffer !== null && titleBuffer.revision === draftQuery.dataUpdatedAt
                          ? titleBuffer.value
                          : editor.title
                      }
                      maxLength={120}
                      aria-invalid={errors.title !== undefined ? true : undefined}
                      aria-describedby={
                        errors.title !== undefined ? 'cfp-proposal-title-error' : undefined
                      }
                      onChange={(event) => {
                        const next = event.target.value
                        setTitleBuffer({ revision: draftQuery.dataUpdatedAt, value: next })
                        setEditor((current) => ({ ...current, title: next, dirty: true }))
                      }}
                    />
                    {errors.title !== undefined ? (
                      <FieldError id="cfp-proposal-title-error">{errors.title}</FieldError>
                    ) : null}
                  </Field>
                ) : currentPage.kind === 'submit' || currentPage.kind === 'review' ? (
                  <CfpReviewSummary
                    form={form}
                    title={editor.title}
                    answers={answers}
                    currentPageId={currentPage.id}
                  />
                ) : undefined}
              </CfpStepRenderer>
            </CardContent>
          </Card>
          {currentPage.kind === 'submit' ? (
            <CfpCoSpeakers formId={form.formId} formVersionId={form.versionId} />
          ) : null}
          <CfpSaveBar
            onBack={stepIndex > 0 ? handleBack : undefined}
            onNext={stepIndex < steps.length - 1 ? handleNext : undefined}
            onDenied={(denial) => {
              parkDraft()
              setSaveDenial(denial)
            }}
          />
        </>
      )}
      {currentPage.kind === 'submit' ? (
        <CfpSubmit
          formVersionId={form.versionId}
          onSubmitted={() => setSubmitted(true)}
          onDenied={(denial) => {
            parkDraft()
            setSaveDenial(denial)
          }}
        />
      ) : null}
      {confirmationActive ? null : announcement !== null ? (
        <StatusLive aria-live="polite">{announcement}</StatusLive>
      ) : null}
    </div>
  )
}

/**
 * A save refused with 401 for a reader whose session never existed: a visitor
 * who opened the public call for papers and started writing. Nothing expired,
 * so the card does not claim it did, and it does not pretend the words on the
 * page were kept anywhere — the whole point of the refusal is that they were
 * not. The door it names is the one that issues a speaker session.
 */
function IdentifyToSaveState() {
  return (
    <PageState
      title="Identify yourself to save your proposal"
      message="Saving a draft needs a speaker session. Start one from the sign-in page — nothing you have typed here has been stored yet."
      action={
        <a href="/start" className={buttonVariants()}>
          Go to speaker sign-in
        </a>
      }
      hint={<PaletteHint />}
    />
  )
}

/**
 * A save OR a submit refused with 403: an organizer following their own public
 * link. They are signed in, just not as a speaker, so a second sign-in is not
 * the way forward — their own workspace is, and the form they landed on is
 * theirs.
 *
 * One state answers both refusals, so the sentence names the identity rather
 * than the operation: "cannot hold a speaker's draft" described a save to a
 * reader who had just pressed Submit.
 */
function OrganizerCannotSaveState() {
  return (
    <PageState
      title="This form saves proposals for speakers"
      message="A proposal belongs to a speaker session, and yours is an organizer one. The call for papers itself is yours to manage from the organizer workspace."
      action={
        <a href="/admin" className={buttonVariants()}>
          Go to the organizer workspace
        </a>
      }
      hint={<PaletteHint />}
    />
  )
}
