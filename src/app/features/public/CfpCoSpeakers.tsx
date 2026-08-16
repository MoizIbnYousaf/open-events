import { useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { MAX_CO_SPEAKERS } from '../../../domain/contact'
import { normalizeEmail } from '../../../domain/invariants/email'
import { isValidEmailAddress } from '../../../domain/invariants/email'
import { announce } from '../../lib/announcer'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '../../../components/ui/card'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import { EmptyState } from '../../../components/ui/empty-state'
import { InboxIcon } from '../../../components/ui/icons'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { SectionHeading } from '../../../components/ui/section-heading'
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
  // The row a removal has been asked for but not yet agreed to. Null means no
  // confirmation is open; the index is the only thing the dialog needs.
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null)
  const baseId = useId()
  const headingRef = useRef<HTMLHeadingElement | null>(null)

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
    setPendingRemoval(null)
    setEditor((current) => ({
      ...current,
      coSpeakers: current.coSpeakers.filter((_, rowIndex) => rowIndex !== index),
      dirty: true,
    }))
    // Adding announced; removing did not, so the polite region was left still
    // reading "Co-speaker 2 of 10 added" with co-speaker 2 gone from the page.
    // The destructive half of the pair is the half that most needs saying.
    announce(`Co-speaker ${index + 1} removed`)
    // The control that was pressed has just unmounted with its row. Focus lands
    // on the section heading — a place to read from, never another action.
    headingRef.current?.focus()
  }

  const summary = Object.values(emailErrors)[0]
  const removalTarget = pendingRemoval === null ? undefined : coSpeakers[pendingRemoval]
  const removalName =
    removalTarget === undefined ? '' : `${removalTarget.firstName} ${removalTarget.lastName}`.trim()

  return (
    <section aria-label="Co-speakers" className="grid gap-3">
      <Card>
        <CardHeader className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <SectionHeading ref={headingRef} tabIndex={-1} className="outline-hidden">
            Co-speakers
          </SectionHeading>
          <p className="text-xs text-muted-foreground">
            {coSpeakers.length} of {MAX_CO_SPEAKERS}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          {coSpeakers.length === 0 ? (
            <EmptyState
              icon={<InboxIcon size={20} />}
              title="Add anyone presenting with you"
              description="Co-speakers receive their own onboarding checklist once the proposal is accepted."
            />
          ) : null}
          {coSpeakers.map((row, index) => {
            // Keyed by the row's own identity, never by its position: Base UI
            // fixes a Field label's id on first render, so index-based ids went
            // stale the moment a row above was removed and every
            // `aria-labelledby` pointed at an element that no longer existed.
            const rowId = `${baseId}-${row.clientId}`
            return (
              <div key={row.clientId} className="grid gap-3 rounded-lg p-3 ring-1 ring-border">
                <div className="flex flex-wrap items-center gap-2">
                  <p id={`${rowId}-name`} className="min-w-0 flex-1 truncate text-sm font-medium">
                    Co-speaker {index + 1}
                  </p>
                  {/* Quiet until it is needed: a remove control that competes
                    with the fields beside it invites the mistake the
                    confirmation below then has to catch. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingRemoval(index)}
                  >
                    Remove co-speaker {index + 1}
                  </Button>
                </div>
                {/* A named section keeps each co-speaker's contact card distinct.
                  The purpose tokens remain truthful to the data being collected,
                  while the per-row section prevents one suggested contact from
                  filling every repeated row.

                  Each control is named by the row heading AND its own label,
                  in that order: ten rows of "First name" told a screen-reader
                  user nothing about which speaker they were filling in. An
                  `aria-label` cannot do this job — the Field primitive wires
                  `aria-labelledby`, which wins — so the row identity is added
                  to that list instead of fighting it, and the visible label
                  stays the last word of the name (WCAG 2.5.3). */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field>
                    <FieldLabel id={`${rowId}-first-label`} htmlFor={`${rowId}-first`}>
                      First name
                    </FieldLabel>
                    <Input
                      id={`${rowId}-first`}
                      aria-labelledby={`${rowId}-name ${rowId}-first-label`}
                      autoComplete={`section-cospeaker-${index + 1} given-name`}
                      value={row.firstName}
                      onChange={(event) => updateRow(index, { firstName: event.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel id={`${rowId}-last-label`} htmlFor={`${rowId}-last`}>
                      Last name
                    </FieldLabel>
                    <Input
                      id={`${rowId}-last`}
                      aria-labelledby={`${rowId}-name ${rowId}-last-label`}
                      autoComplete={`section-cospeaker-${index + 1} family-name`}
                      value={row.lastName}
                      onChange={(event) => updateRow(index, { lastName: event.target.value })}
                    />
                  </Field>
                  <Field invalid={emailErrors[index] !== undefined}>
                    <FieldLabel id={`${rowId}-email-label`} htmlFor={`${rowId}-email`}>
                      Email
                    </FieldLabel>
                    <Input
                      id={`${rowId}-email`}
                      aria-labelledby={`${rowId}-name ${rowId}-email-label`}
                      type="email"
                      autoComplete={`section-cospeaker-${index + 1} email`}
                      value={row.email}
                      aria-invalid={emailErrors[index] !== undefined ? true : undefined}
                      aria-describedby={
                        emailErrors[index] !== undefined ? `${rowId}-email-error` : undefined
                      }
                      onChange={(event) => updateRow(index, { email: event.target.value })}
                    />
                    {emailErrors[index] !== undefined ? (
                      <FieldError id={`${rowId}-email-error`}>{emailErrors[index]}</FieldError>
                    ) : null}
                  </Field>
                </div>
              </div>
            )
          })}
          {summary !== undefined ? <AlertLive>{summary}</AlertLive> : null}
        </CardContent>
        {coSpeakers.length < MAX_CO_SPEAKERS ? (
          <CardFooter>
            <Button type="button" variant="outline" onClick={handleAdd}>
              Add co-speaker
            </Button>
          </CardFooter>
        ) : null}
      </Card>
      {/* Removing a row throws away everything typed into it and there is no
          undo, so the click asks rather than acts. It adds no request: the
          dialog only decides whether the local edit happens. */}
      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null)
        }}
        title={`Remove co-speaker ${(pendingRemoval ?? 0) + 1}`}
        description={
          removalName === ''
            ? 'The details typed into this row are discarded. This action cannot be undone.'
            : `${removalName} and the details typed into this row are discarded. This action cannot be undone.`
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (pendingRemoval !== null) handleRemove(pendingRemoval)
        }}
      />
    </section>
  )
}
