import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { MAX_CO_SPEAKERS, normalizeEmail } from '../../../domain'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
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

export default function CfpCoSpeakers({ formId, formVersionId }: CfpCoSpeakersProps) {
  const queryClient = useQueryClient()
  const editorQuery = usePublicEditor(formId, formVersionId)
  const coSpeakers = editorQuery.data?.coSpeakers ?? []
  const [duplicateAlert, setDuplicateAlert] = useState(false)
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
    setDuplicateAlert(false)
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
            setDuplicateAlert(true)
            setEditor((current) => ({ ...current, coSpeakers: next, dirty: true }))
            return
          }
        }
      }
    }
    if (next.length >= MAX_CO_SPEAKERS) return
    next.push({ firstName: '', lastName: '', email: '' })
    setDuplicateAlert(false)
    setEditor((current) => ({ ...current, coSpeakers: next, dirty: true }))
  }

  const handleRemove = (index: number) => {
    setDuplicateAlert(false)
    setEditor((current) => ({
      ...current,
      coSpeakers: current.coSpeakers.filter((_, rowIndex) => rowIndex !== index),
      dirty: true,
    }))
  }

  return (
    <section aria-label="Co-speakers" className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Co-speakers</h2>
        <p className="text-sm text-muted-foreground">
          {coSpeakers.length} of {MAX_CO_SPEAKERS}
        </p>
      </div>
      {coSpeakers.map((row, index) => (
        <div key={index} className="grid gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Co-speaker {index + 1}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => handleRemove(index)}>
              Remove co-speaker {index + 1}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label htmlFor={`${baseId}-${index}-first`}>First name</label>
              <input
                id={`${baseId}-${index}-first`}
                className={inputClass}
                value={row.firstName}
                onChange={(event) => updateRow(index, { firstName: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${baseId}-${index}-last`}>Last name</label>
              <input
                id={`${baseId}-${index}-last`}
                className={inputClass}
                value={row.lastName}
                onChange={(event) => updateRow(index, { lastName: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${baseId}-${index}-email`}>Email</label>
              <input
                id={`${baseId}-${index}-email`}
                className={inputClass}
                type="email"
                value={row.email}
                onChange={(event) => updateRow(index, { email: event.target.value })}
              />
            </div>
          </div>
        </div>
      ))}
      {duplicateAlert ? <AlertLive>This email is already listed as a co-speaker.</AlertLive> : null}
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
