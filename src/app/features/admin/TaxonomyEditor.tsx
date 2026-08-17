import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form'
import { z } from 'zod'

import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import { useReplaceTaxonomies, useTaxonomies } from '../../queries/admin-events'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import type { TaxonomyItemInput, TaxonomyListDto } from '../../../application/dtos/taxonomy.dto'
import { TAXONOMY_KINDS, type TaxonomyKind } from '../../../domain/taxonomy'
import { ClipboardIcon } from '../../../components/ui/icons'

import AppShell from '../nav/AppShell'
import { DeniedState, ExpiredSessionState, ForbiddenState, LoadErrorState } from './AdminStates'

const taxonomySchema = z
  .object({
    rows: z
      .array(
        z.object({
          kind: z.enum(TAXONOMY_KINDS),
          key: z.string().trim().min(1, 'Key is required'),
          label: z.string().trim().min(1, 'Label is required'),
        }),
      )
      .superRefine((rows, context) => {
        const seen = new Set<string>()
        rows.forEach((row, index) => {
          const pair = `${row.kind}:${row.key}`
          if (seen.has(pair)) {
            context.addIssue({
              code: 'custom',
              path: [index, 'key'],
              message: 'Duplicate key within the same kind',
            })
          }
          seen.add(pair)
        })
      }),
  })
  .superRefine((values, context) => {
    if (values.rows.length === 0) {
      context.addIssue({ code: 'custom', path: ['rows'], message: 'Add at least one item' })
    }
  })

type TaxonomyValues = z.infer<typeof taxonomySchema>

interface TaxonomyRow {
  readonly kind: TaxonomyKind
  readonly key: string
  readonly label: string
}

function toRows(items: TaxonomyListDto['items']): TaxonomyRow[] {
  return items.map((item) => ({ kind: item.kind, key: item.key, label: item.label }))
}

function toItems(rows: TaxonomyRow[]): TaxonomyItemInput[] {
  const positions = new Map<TaxonomyKind, number>()
  return rows.map((row) => {
    const position = positions.get(row.kind) ?? 0
    positions.set(row.kind, position + 1)
    return { kind: row.kind, key: row.key.trim(), label: row.label.trim(), position }
  })
}

/**
 * Merges the server response with the user's in-flight edits: rows the user
 * changed keep their edited values; untouched rows adopt the server's
 * authoritative values (including server-applied changes).
 */
function mergeServerRows(
  localRows: readonly TaxonomyRow[],
  originalRows: readonly TaxonomyRow[],
  serverRows: readonly TaxonomyRow[],
): TaxonomyRow[] {
  const localByPair = new Map(localRows.map((row) => [`${row.kind}:${row.key}`, row]))
  const originalByPair = new Map(originalRows.map((row) => [`${row.kind}:${row.key}`, row.label]))
  return serverRows.map((serverRow) => {
    const pair = `${serverRow.kind}:${serverRow.key}`
    const local = localByPair.get(pair)
    if (local === undefined) return serverRow
    const original = originalByPair.get(pair)
    if (original === undefined || local.label !== original) return local
    return serverRow
  })
}

function capitalize(kind: TaxonomyKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

export default function TaxonomyEditor() {
  return <TaxonomyEditorScreen />
}

function TaxonomyEditorScreen() {
  const params = useParams({ strict: false })
  const slug = params.slug
  const navigate = useNavigate()
  const taxonomyQuery = useTaxonomies(slug)
  const save = useReplaceTaxonomies(slug ?? '')

  useEffect(() => {
    document.title = 'Taxonomies — Open Events'
  }, [])

  if (taxonomyQuery.isError) {
    const code = getApiErrorCode(taxonomyQuery.error)
    if (code === 'forbidden') return <ForbiddenState />
    if (code === 'not_found') return <DeniedState />
    if (code === 'unauthorized') {
      return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
    }
    return (
      <LoadErrorState
        message={getApiErrorMessage(taxonomyQuery.error, 'Unable to load taxonomies')}
        pending={taxonomyQuery.isFetching}
        onRetry={() => void taxonomyQuery.refetch()}
      />
    )
  }

  if (taxonomyQuery.isPending || taxonomyQuery.data === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Card aria-busy="true" aria-label="Loading taxonomies">
          <CardContent className="grid gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <StatusLive aria-live="polite">Loading taxonomies…</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <AppShell slug={slug ?? ''}>
      {/* No back link: Taxonomies is a rail destination, so the rail is the way
          back and says so with `aria-current`. See `BackLink.tsx`. */}
      <div className="mx-auto grid w-full max-w-3xl gap-3">
        <TaxonomyForm
          key={taxonomyQuery.data.eventId}
          data={taxonomyQuery.data}
          save={save}
          navigateToLogin={() => void navigate({ to: '/admin' })}
        />
      </div>
    </AppShell>
  )
}

/**
 * A card section title. `CardTitle` renders a div, and each taxonomy kind is
 * real document structure under the page's single h1 — so the heading level is
 * handed to the primitive's `render` escape rather than reproduced by a
 * hand-written h2 wearing a copy of the card's class string.
 */
function SectionTitle({ children }: { readonly children: ReactNode }) {
  return <CardTitle level={2}>{children}</CardTitle>
}

interface TaxonomyFormProps {
  readonly data: TaxonomyListDto
  readonly save: ReturnType<typeof useReplaceTaxonomies>
  readonly navigateToLogin: () => void
}

type SaveState =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string }

function TaxonomyForm({ data, save, navigateToLogin }: TaxonomyFormProps) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setFocus,
    getValues,
    formState: { errors, isDirty },
  } = useForm<TaxonomyValues>({ defaultValues: { rows: toRows(data.items) } })
  const { fields, append } = useFieldArray({ control, name: 'rows' })
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState | null>(null)

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const groups = useMemo(() => {
    const byKind = new Map<TaxonomyKind, number[]>()
    for (const kind of TAXONOMY_KINDS) byKind.set(kind, [])
    fields.forEach((field, index) => {
      byKind.get(field.kind)?.push(index)
    })
    return TAXONOMY_KINDS.map((kind) => ({ kind, indices: byKind.get(kind) ?? [] }))
  }, [fields])

  const addKind = (kind: TaxonomyKind) => {
    append({ kind, key: '', label: '' })
  }

  const onSubmit = () => {
    setSavedMessage(null)
    setSaveState(null)
    const parsed = taxonomySchema.safeParse(getValues())
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue !== undefined) {
        const path = issue.path.join('.') as FieldPath<TaxonomyValues>
        setError(path, { type: 'manual', message: issue.message })
        setFocus(path)
      }
      return
    }
    const originalRows = toRows(data.items)
    // WHOLE-SET REPLACE: this PUT is the taxonomy, not a patch of it — a row
    // missing from the payload is a row deleted on the server, along with
    // whatever a schedule or a submission had pinned to it.
    //
    // It is safe to save without asking today only because the form has no way
    // to drop a row: it adds and it edits, so every save carries the set it was
    // given back. ANY FUTURE REMOVE UI MUST BRING THE CONSENT RUNG WITH IT —
    // a save that silently unschedules sessions and unroutes submissions is
    // exactly the cascade C0 §8 says must name its blast radius before it runs,
    // and it is the reactivation trigger recorded in confirm-dialog.tsx.
    save.mutate(toItems(parsed.data.rows), {
      onSuccess: (server) => {
        const current = taxonomySchema.safeParse(getValues())
        const submittedWithServerTruth = mergeServerRows(
          parsed.data.rows,
          originalRows,
          toRows(server.items),
        )
        reset({
          rows: mergeServerRows(
            current.success ? current.data.rows : parsed.data.rows,
            parsed.data.rows,
            submittedWithServerTruth,
          ),
        })
        setSavedMessage('Saved')
        // No announce(): the header chip beside the Save button is itself a
        // live region already saying this (DEC-014, F-R3-13).
      },
      onError: (error) => {
        const code = getApiErrorCode(error)
        if (code === 'forbidden') setSaveState({ kind: 'forbidden' })
        else if (code === 'not_found') setSaveState({ kind: 'denied' })
        else
          setSaveState({
            kind: 'error',
            message: getApiErrorMessage(error, 'Unable to save the taxonomies'),
          })
        // No announce(): the summary alert below renders this same message and
        // is already an assertive live region (DEC-014).
        if (code === 'unauthorized') {
          window.setTimeout(() => navigateToLogin(), 100)
        }
      },
    })
  }

  if (fields.length === 0) {
    return (
      <div className="grid gap-3">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Taxonomies</PageHeaderTitle>
            <PageHeaderDescription>
              The vocabulary every submission is filed under.
            </PageHeaderDescription>
          </PageHeaderContent>
        </PageHeader>
        {/* An empty state that can act asks for the action: the title is the
            instruction, the sentence under it says what the instruction buys. */}
        <EmptyState
          icon={<ClipboardIcon size={20} />}
          title="Add your first taxonomy item"
          description="Formats, tracks and levels are what a speaker picks from and what an organizer files a proposal under."
        >
          <div className="flex flex-wrap gap-2">
            {TAXONOMY_KINDS.map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="outline"
                onClick={() => append({ kind, key: '', label: '' })}
              >
                {`Add ${kind}`}
              </Button>
            ))}
          </div>
        </EmptyState>
      </div>
    )
  }

  // One role=alert per form: the submit-level summary. Per-row messages are
  // FieldErrors wired into each control's aria-describedby.
  const summaryMessage =
    saveState !== null
      ? saveState.kind === 'forbidden'
        ? 'Access forbidden.'
        : saveState.kind === 'denied'
          ? 'Not found.'
          : saveState.message
      : errors.rows !== undefined
        ? 'Please fix the highlighted fields.'
        : null

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-3"
      data-tour="taxonomy-workspace"
      noValidate
    >
      <PageHeader className="min-h-8">
        <PageHeaderContent>
          <PageHeaderTitle>Taxonomies</PageHeaderTitle>
          <PageHeaderDescription>
            The vocabulary every submission is filed under.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          {/* One stable region for both outcomes, mounted before either has
              anything to say: a live region created together with its text
              is not in the accessibility tree when the text arrives, so it
              announces nothing. The saved chip is cleared at submit, so the
              in-flight message never overwrites a live one. */}
          <StatusLive aria-live="polite" className="text-xs">
            {save.isPending ? 'Saving the taxonomies…' : savedMessage}
          </StatusLive>
          <Button type="submit" pending={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </PageHeaderActions>
      </PageHeader>
      {summaryMessage !== null ? <AlertLive>{summaryMessage}</AlertLive> : null}
      {groups.map((group) => (
        <Card key={group.kind}>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <SectionTitle>{capitalize(group.kind)}</SectionTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => addKind(group.kind)}>
              {`Add ${group.kind}`}
            </Button>
          </CardHeader>
          <CardContent>
            {/* Rows divide on a hairline and share the card's gutters, so a
                kind with twelve items still reads as one object rather than
                twelve boxes. Top rule only: a closing rule under the last row
                left a hairline floating 12px above the card's own border,
                inside the card's bottom padding, reading as a row that failed
                to render. */}
            <ul className="-mx-3 divide-y divide-border border-t border-border">
              {group.indices.map((index) => (
                <li
                  key={fields[index]?.id ?? index}
                  className="grid gap-2 px-3 py-2 sm:grid-cols-2 sm:gap-3"
                >
                  <Field invalid={errors.rows?.[index]?.key !== undefined}>
                    <FieldLabel htmlFor={`taxonomy-key-${index}`}>Key</FieldLabel>
                    <Input id={`taxonomy-key-${index}`} {...register(`rows.${index}.key`)} />
                    {errors.rows?.[index]?.key !== undefined ? (
                      <FieldError id={`taxonomy-key-${index}-error`}>
                        {errors.rows[index]?.key?.message}
                      </FieldError>
                    ) : null}
                  </Field>
                  <Field invalid={errors.rows?.[index]?.label !== undefined}>
                    <FieldLabel htmlFor={`taxonomy-label-${index}`}>Label</FieldLabel>
                    <Input id={`taxonomy-label-${index}`} {...register(`rows.${index}.label`)} />
                    {errors.rows?.[index]?.label !== undefined ? (
                      <FieldError id={`taxonomy-label-${index}-error`}>
                        {errors.rows[index]?.label?.message}
                      </FieldError>
                    ) : null}
                  </Field>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </form>
  )
}
