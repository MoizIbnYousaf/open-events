import { useRef, useState } from 'react'

import type {
  SubmissionViewDto,
  SubmissionViewState,
} from '../../../application/dtos/submission-view.dto'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { getApiErrorMessage } from '../../api/admin-events'
import {
  useCreateSubmissionView,
  useDeleteSubmissionView,
  useSubmissionViews,
} from '../../queries/admin-submission-views'

export function SubmissionViews({
  eventSlug,
  activeViewId,
  currentState,
  onApply,
  onDeleted,
}: {
  readonly eventSlug: string
  readonly activeViewId: string | undefined
  readonly currentState: SubmissionViewState
  readonly onApply: (view: SubmissionViewDto) => void
  readonly onDeleted: (id: string) => void
}) {
  const views = useSubmissionViews(eventSlug)
  const create = useCreateSubmissionView(eventSlug)
  const remove = useDeleteSubmissionView(eventSlug)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const list = views.data ?? []
  const active = list.find((view) => view.id === activeViewId)

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(12rem,18rem)_auto] sm:items-start">
      <div className="grid gap-2">
        <NativeSelect
          aria-label="Saved submission view"
          value={active?.id ?? ''}
          disabled={views.isPending || views.isError}
          onChange={(event) => {
            setConfirmDelete(false)
            const view = list.find((candidate) => candidate.id === event.target.value)
            if (view !== undefined) onApply(view)
          }}
        >
          <option value="">Current filters</option>
          {list.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </NativeSelect>
        {views.isError ? (
          <div className="grid justify-items-start gap-2">
            <AlertLive>Saved views could not be loaded.</AlertLive>
            <Button type="button" variant="outline" size="sm" onClick={() => void views.refetch()}>
              Retry saved views
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <details ref={detailsRef} className="rounded-lg border border-border bg-card">
          <summary className="flex min-h-8 cursor-pointer list-none items-center rounded-lg px-3 py-1 text-sm font-medium outline-hidden marker:hidden hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
            Save current view
          </summary>
          <form
            className="grid min-w-64 gap-3 border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate(
                { name, state: currentState },
                {
                  onSuccess: (view) => {
                    setName('')
                    setConfirmDelete(false)
                    detailsRef.current?.removeAttribute('open')
                    onApply(view)
                  },
                },
              )
            }}
          >
            <Field>
              <FieldLabel htmlFor="submission-view-name">View name</FieldLabel>
              <Input
                id="submission-view-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {create.isError ? (
              <AlertLive>
                {getApiErrorMessage(create.error, 'The view could not be saved.')}
              </AlertLive>
            ) : null}
            <Button
              type="submit"
              size="sm"
              pending={create.isPending}
              disabled={name.trim() === ''}
            >
              Save view
            </Button>
          </form>
        </details>

        {active !== undefined ? (
          confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-1">
              <span className="px-1 text-sm">Delete {active.name}?</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                pending={remove.isPending}
                onClick={() =>
                  remove.mutate(active.id, {
                    onSuccess: () => {
                      setConfirmDelete(false)
                      onDeleted(active.id)
                    },
                  })
                }
              >
                Confirm delete view
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              Delete saved view
            </Button>
          )
        ) : null}
        {remove.isError && active !== undefined ? (
          <div className="grid basis-full justify-items-start gap-2">
            <AlertLive>
              {getApiErrorMessage(remove.error, 'The saved view could not be deleted.')}
            </AlertLive>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void views.refetch().then((result) => {
                  if (result.data?.some((view) => view.id === active.id) !== false) return
                  setConfirmDelete(false)
                  onDeleted(active.id)
                })
              }
            >
              Reload saved views
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
