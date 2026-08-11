import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { MAX_CO_SPEAKERS } from '../../../domain/contact'
import { normalizeEmail } from '../../../domain/invariants/email'
import { isValidEmailAddress } from '../../../domain/invariants/email'
import { announce } from '../../lib/announcer'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import {
  publicDraftQueryKeys,
  usePublicEditor,
  type CoSpeakerDraft,
  type PublicEditorState,
} from '../../queries/public-drafts'

interface CfpCoSpeakersProps {
  readonly formId: string
  readonly formVersionId: string
}

const inputClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none disabled:opacity-50 md:text-sm'

const DUPLICATE_MESSAGE = 'This email is already listed as a co-speaker.'
const INVALID_EMAIL_MESSAGE = 'Enter a valid email address for this co-speaker.'

export default function CfpCoSpeakers({ formId, formVersionId }: CfpCoSpeakersProps) {
  const queryClient = useQueryClient()
  const editorQuery = usePublicEditor(formId, formVersionId)
  const coSpeakers = editorQuery.data?.coSpeakers ?? []
  // Row-indexed email problem. The duplicate condition used to surface only as
  // an unattached form-level alert, so a screen-reader user was told something
  // was wrong without being told which row.
  const [emailErrors, setEmailErrors] = useState<Readonly<Record<number, string>>>({})
  const baseId = useId()

  const setEditor = (updater: (current: PublicEditorState) => PublicEditorState) => {
    queryClient.setQueryData<PublicEditorState>(publicDraftQueryKeys.editor, (current) => {
      if (current === undefined) {
        throw new Error('Editor state is not initialized')
      }
      return updater(current)
    })
  }

  const updateRow = (index: number, patch: Partial<CoSpeakerDraft>) => {
    setEmailErrors({})
    setEditor((current) => ({
      ...current,
      coSpeakers: current.coSpeakers.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
      dirty: true,
    }))
  }

  const handleAdd = () => {
    const next = [...coSpeakers]
    if (next.length > 0) {
      const lastIndex = next.length - 1
      const last = next[lastIndex]
      if (last !== undefined) {
        const normalized = normalizeEmail(last.email)
        if (normalized !== '') {
          const earlier = next
            .slice(0, lastIndex)
            .some((row) => normalizeEmail(row.email) === normalized)
          next[lastIndex] = { ...last, email: normalized }
          if (earlier) {
            // The summary AlertLive below carries this same sentence and is
            // the one live region for it (DEC-014).
            setEmailErrors({ [lastIndex]: DUPLICATE_MESSAGE })
            setEditor((current) => ({ ...current, coSpeakers: next, dirty: true }))
            return
          }
          // Reuse the domain invariant so the client and the API can never
          // disagree about what a valid co-speaker address is.
          if (!isValidEmailAddress(normalized)) {
            setEmailErrors({ [lastIndex]: INVALID_EMAIL_MESSAGE })
            setEditor((current) => ({ ...current, coSpeakers: next, dirty: true }))
            return
          }
        }
      }
    }
    if (next.length >= MAX_CO_SPEAKERS) return
    next.push({ clientId: crypto.randomUUID(), firstName: '', lastName: '', email: '' })
    announce(`Co-speaker ${next.length} of ${MAX_CO_SPEAKERS} added`)
    setEmailErrors({})
    setEditor((current) => ({ ...current, coSpeakers: next, dirty: true }))
  }

  const handleRemove = (index: number) => {
    setEmailErrors({})
    setEditor((current) => ({
      ...current,
      coSpeakers: current.coSpeakers.filter((_, rowIndex) => rowIndex !== index),
      dirty: true,
    }))
  }

  const summary = Object.values(emailErrors)[0]

  return (
    <section aria-label="Co-speakers" className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Co-speakers</h2>
        <p className="text-sm text-muted-foreground">
          {coSpeakers.length} of {MAX_CO_SPEAKERS}
        </p>
      </div>
      {coSpeakers.map((row, index) => (
        <div key={row.clientId} className="grid gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Co-speaker {index + 1}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => handleRemove(index)}>
              Remove co-speaker {index + 1}
            </Button>
          </div>
          {/* A named section keeps each co-speaker's contact card distinct.
              The purpose tokens remain truthful to the data being collected,
              while the per-row section prevents one suggested contact from
              filling every repeated row. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor={`${baseId}-${index}-first`}>First name</FieldLabel>
              <input
                id={`${baseId}-${index}-first`}
                aria-label={`Co-speaker ${index + 1} first name`}
                className={inputClass}
                autoComplete={`section-cospeaker-${index + 1} given-name`}
                value={row.firstName}
                onChange={(event) => updateRow(index, { firstName: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${baseId}-${index}-last`}>Last name</FieldLabel>
              <input
                id={`${baseId}-${index}-last`}
                aria-label={`Co-speaker ${index + 1} last name`}
                className={inputClass}
                autoComplete={`section-cospeaker-${index + 1} family-name`}
                value={row.lastName}
                onChange={(event) => updateRow(index, { lastName: event.target.value })}
              />
            </Field>
            <Field invalid={emailErrors[index] !== undefined}>
              <FieldLabel htmlFor={`${baseId}-${index}-email`}>Email</FieldLabel>
              <input
                id={`${baseId}-${index}-email`}
                aria-label={`Co-speaker ${index + 1} email`}
                className={inputClass}
                type="email"
                autoComplete={`section-cospeaker-${index + 1} email`}
                value={row.email}
                aria-invalid={emailErrors[index] !== undefined ? true : undefined}
                aria-describedby={
                  emailErrors[index] !== undefined ? `${baseId}-${index}-email-error` : undefined
                }
                onChange={(event) => updateRow(index, { email: event.target.value })}
              />
              {emailErrors[index] !== undefined ? (
                <FieldError id={`${baseId}-${index}-email-error`}>{emailErrors[index]}</FieldError>
              ) : null}
            </Field>
          </div>
        </div>
      ))}
      {summary !== undefined ? <AlertLive>{summary}</AlertLive> : null}
      {coSpeakers.length < MAX_CO_SPEAKERS ? (
        <div>
          <Button type="button" onClick={handleAdd}>
            Add co-speaker
          </Button>
        </div>
      ) : null}
    </section>
  )
}
