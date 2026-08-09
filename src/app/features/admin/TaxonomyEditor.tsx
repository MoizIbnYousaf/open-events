import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form'
import { z } from 'zod'

import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import { useReplaceTaxonomies, useTaxonomies } from '../../queries/admin-events'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import type { TaxonomyItemInput, TaxonomyListDto } from '../../../application'
import { TAXONOMY_KINDS, type TaxonomyKind } from '../../../domain'

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
    document.title = 'Taxonomies — SpeakerOps'
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
        onRetry={() => void taxonomyQuery.refetch()}
      />
    )
  }

  if (taxonomyQuery.isPending || taxonomyQuery.data === undefined) {
    return (
      <Card aria-busy="true" aria-label="Loading taxonomies">
        <CardContent className="grid gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      <TaxonomyForm
        key={taxonomyQuery.data.eventId}
        data={taxonomyQuery.data}
        save={save}
        navigateToLogin={() => void navigate({ to: '/admin' })}
      />
      <Link
        to="/admin/events/$slug"
        params={{ slug: slug ?? '' }}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to event settings
      </Link>
    </div>
  )
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
  const [originalRows, setOriginalRows] = useState<TaxonomyRow[]>(() => toRows(data.items))
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
    const order: TaxonomyKind[] = []
    const byKind = new Map<TaxonomyKind, number[]>()
    fields.forEach((field, index) => {
      const existing = byKind.get(field.kind)
      if (existing === undefined) {
        byKind.set(field.kind, [index])
        order.push(field.kind)
      } else {
        existing.push(index)
      }
    })
    return order.map((kind) => ({ kind, indices: byKind.get(kind) ?? [] }))
  }, [fields])

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
    save.mutate(toItems(parsed.data.rows), {
      onSuccess: (server) => {
        reset({
          rows: mergeServerRows(parsed.data.rows, originalRows, toRows(server.items)),
        })
        setOriginalRows(toRows(server.items))
        setSavedMessage('Saved')
      },
      onError: (error) => {
        const code = getApiErrorCode(error)
        if (code === 'forbidden') setSaveState({ kind: 'forbidden' })
        else if (code === 'not_found') setSaveState({ kind: 'denied' })
        else setSaveState({ kind: 'error', message: getApiErrorMessage(error, 'Unable to save') })
        if (code === 'unauthorized') {
          window.setTimeout(() => navigateToLogin(), 100)
        }
      },
    })
  }

  if (fields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <h1 className="font-heading text-base leading-snug font-medium">Taxonomies</h1>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            No taxonomy items yet — add first item to get started.
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => append({ kind: 'format', key: '', label: '' })}
            >
              Add item
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-base leading-snug font-medium">Taxonomies</h1>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6" noValidate>
          {groups.map((group) => (
            <section key={group.kind} className="grid gap-3">
              <h2 className="text-base font-semibold">{capitalize(group.kind)}</h2>
              {group.indices.map((index) => (
                <div key={fields[index]?.id ?? index} className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label htmlFor={`taxonomy-key-${index}`}>Key</label>
                    <Input
                      id={`taxonomy-key-${index}`}
                      aria-invalid={errors.rows?.[index]?.key !== undefined ? true : undefined}
                      {...register(`rows.${index}.key`)}
                    />
                    {errors.rows?.[index]?.key !== undefined ? (
                      <AlertLive>{errors.rows?.[index]?.key?.message}</AlertLive>
                    ) : null}
                  </div>
                  <div className="grid gap-1.5">
                    <label htmlFor={`taxonomy-label-${index}`}>Label</label>
                    <Input
                      id={`taxonomy-label-${index}`}
                      aria-invalid={errors.rows?.[index]?.label !== undefined ? true : undefined}
                      {...register(`rows.${index}.label`)}
                    />
                    {errors.rows?.[index]?.label !== undefined ? (
                      <AlertLive>{errors.rows?.[index]?.label?.message}</AlertLive>
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          ))}
          {saveState !== null ? (
            saveState.kind === 'forbidden' ? (
              <AlertLive>Access forbidden.</AlertLive>
            ) : saveState.kind === 'denied' ? (
              <AlertLive>Not found.</AlertLive>
            ) : (
              <AlertLive>{saveState.message}</AlertLive>
            )
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={save.isPending}
                aria-label={save.isPending ? 'Saving…' : 'Save'}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => append({ kind: 'format', key: '', label: '' })}
              >
                Add item
              </Button>
            </div>
            {savedMessage !== null ? <StatusLive>{savedMessage}</StatusLive> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
