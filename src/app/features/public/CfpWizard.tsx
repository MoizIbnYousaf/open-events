import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import type { FormDefinitionDto } from '../../../application'
import type { AnswerValue, ElementFieldKey } from '../../../domain'
import { isElementRequiredDto, isElementVisibleDto } from '../../lib/form-engine'
import { getApiErrorCode } from '../../api/admin-events'
import { ExpiredSessionState, ForbiddenState } from '../admin/AdminStates'
import { AlertLive } from '../../../components/ui/alert-live'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { StatusLive } from '../../../components/ui/status-live'
import {
  publicDraftQueryKeys,
  recoverPublicSession,
  useActiveDraft,
  usePublicEditor,
  type PublicEditorState,
} from '../../queries/public-drafts'
import CfpCoSpeakers from './CfpCoSpeakers'
import CfpSaveBar from './CfpSaveBar'
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
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const fieldRefs = useRef(new Map<ElementFieldKey, HTMLElement | null>())
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const lastChangedRef = useRef<ElementFieldKey | null>(null)
  const lastFocusedElementRef = useRef<HTMLElement | null>(null)
  const prevVisibleRef = useRef<ReadonlySet<ElementFieldKey>>(new Set())
  const previousStepRef = useRef(stepIndex)

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
    if (draftQuery.isError || draftQuery.data === undefined) return
    const draft = draftQuery.data
    const editorBefore = queryClient.getQueryData<PublicEditorState>(publicDraftQueryKeys.editor)
    const reloadArmed = editorBefore?.reloadIntent === true
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
  useEffect(() => {
    if (previousStepRef.current === stepIndex) return
    previousStepRef.current = stepIndex
    prevVisibleRef.current = new Set(visibleFields)
    const first = visibleFields[0]
    if (first !== undefined) {
      fieldRefs.current.get(first)?.focus()
    }
  }, [stepIndex, visibleFields])

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
    const issues: { readonly fieldKey: ElementFieldKey; readonly message: string }[] = []
    for (const element of stepElements) {
      if (element.fieldKey === null) continue
      if (!isElementVisibleDto(element, form.conditionRules, answers)) continue
      if (
        isElementRequiredDto(element, form.conditionRules, answers) &&
        isEmptyAnswer(answers[element.fieldKey])
      ) {
        issues.push({ fieldKey: element.fieldKey, message: 'This field is required' })
      }
    }
    const titleQuestionOnStep = stepElements.some((element) => element.fieldKey === TITLE_FIELD_KEY)
    const titleIsRequired =
      (stepIndex === proposalPageIndex && !hasTitleQuestion) || titleQuestionOnStep
    if (titleIsRequired && editor.title.trim().length === 0) {
      issues.push({ fieldKey: TITLE_FIELD_KEY, message: 'Proposal title is required' })
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
    return (
      <Card>
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertLive>Unable to load your draft.</AlertLive>
        </CardContent>
      </Card>
    )
  }

  if (currentPage === undefined) return null

  const confirmationActive = submitted && currentPage.kind === 'submit'

  return (
    <div className="grid gap-6">
      {confirmationActive ? null : (
        <>
          <h1 className="text-2xl font-semibold">Call for papers</h1>
          <CfpStepper
            steps={steps}
            currentIndex={stepIndex}
            onBack={handleBack}
            onNext={handleNext}
          />
          {stepIndex === proposalPageIndex && !hasTitleQuestion ? (
            <Field invalid={errors.title !== undefined}>
              <FieldLabel htmlFor="cfp-proposal-title">Proposal title</FieldLabel>
              <Input
                id="cfp-proposal-title"
                ref={titleInputRef}
                required
                value={editor.title}
                maxLength={120}
                aria-invalid={errors.title !== undefined ? true : undefined}
                aria-describedby={
                  errors.title !== undefined ? 'cfp-proposal-title-error' : undefined
                }
                onChange={(event) =>
                  setEditor((current) => ({ ...current, title: event.target.value, dirty: true }))
                }
              />
              {errors.title !== undefined ? (
                <FieldError id="cfp-proposal-title-error">{errors.title}</FieldError>
              ) : null}
            </Field>
          ) : null}
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
          />
          <CfpSaveBar />
        </>
      )}
      {currentPage.kind === 'submit' ? (
        <>
          {confirmationActive ? null : (
            <CfpCoSpeakers formId={form.formId} formVersionId={form.versionId} />
          )}
          <CfpSubmit
            formId={form.formId}
            formVersionId={form.versionId}
            onSubmitted={() => setSubmitted(true)}
          />
        </>
      ) : null}
      {confirmationActive ? null : announcement !== null ? (
        <StatusLive aria-live="polite">{announcement}</StatusLive>
      ) : null}
    </div>
  )
}
