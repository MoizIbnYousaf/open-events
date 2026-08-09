import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Controller, useForm, type FieldPath } from 'react-hook-form'
import { z } from 'zod'

import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import { useEventConfig, useFormsList, useUpdateEventConfig } from '../../queries/admin-events'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import type { AdminEventConfigDto, UpdateEventConfigInput } from '../../../application'
import { EVENT_STATUSES } from '../../../domain'

import { DeniedState, ExpiredSessionState, ForbiddenState, LoadErrorState } from './AdminStates'

const eventConfigSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    timezone: z
      .string()
      .min(1, 'Timezone is required')
      .refine(isValidIanaTimezone, 'Enter a valid IANA timezone'),
    status: z.enum(EVENT_STATUSES),
    websiteUrl: z.string(),
    organizerContact: z.string(),
    venue: z.string(),
    eventType: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
  })
  .superRefine((values, context) => {
    const hasStart = values.startsAt.trim().length > 0
    const hasEnd = values.endsAt.trim().length > 0
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: 'custom',
        path: ['startsAt'],
        message: 'Start and end dates must be set together',
      })
    }
  })

type EventConfigValues = z.infer<typeof eventConfigSchema>

type MutableEventConfigPatch = {
  -readonly [K in keyof UpdateEventConfigInput]?: UpdateEventConfigInput[K]
}

function isoToLocalInput(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function localInputToIso(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : new Date(trimmed).toISOString()
}

function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function toFormValues(dto: AdminEventConfigDto): EventConfigValues {
  return {
    name: dto.name,
    timezone: dto.timezone,
    status: dto.status,
    websiteUrl: dto.websiteUrl ?? '',
    organizerContact: dto.organizerContact ?? '',
    venue: dto.venue ?? '',
    eventType: dto.eventType ?? '',
    startsAt: isoToLocalInput(dto.startsAt),
    endsAt: isoToLocalInput(dto.endsAt),
  }
}

export default function EventConfig() {
  return <EventConfigScreen />
}

function EventConfigScreen() {
  const params = useParams({ strict: false })
  const slug = params.slug
  const navigate = useNavigate()
  const formsQuery = useFormsList(slug)
  const configQuery = useEventConfig(slug)
  const save = useUpdateEventConfig(slug ?? '')

  useEffect(() => {
    document.title = 'Event settings — SpeakerOps'
  }, [])

  if (configQuery.isError) {
    const code = getApiErrorCode(configQuery.error)
    if (code === 'forbidden') return <ForbiddenState />
    if (code === 'not_found') return <DeniedState />
    if (code === 'unauthorized') {
      return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
    }
    return (
      <LoadErrorState
        message={getApiErrorMessage(configQuery.error, 'Unable to load the event')}
        onRetry={() => void configQuery.refetch()}
      />
    )
  }

  if (configQuery.isPending || configQuery.data === undefined) {
    return (
      <Card aria-busy="true" aria-label="Loading event settings">
        <CardContent className="grid gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      <EventConfigForm
        key={configQuery.data.id}
        dto={configQuery.data}
        save={save}
        slug={slug ?? ''}
        navigateToLogin={() => void navigate({ to: '/admin' })}
      />
      <FormsList query={formsQuery} slug={slug ?? ''} />
    </div>
  )
}

function FormsList({
  query,
  slug,
}: {
  readonly query: ReturnType<typeof useFormsList>
  readonly slug: string
}) {
  if (query.isPending) {
    return (
      <Card aria-busy="true" aria-label="Loading forms">
        <CardHeader>
          <CardTitle>Forms</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>
    )
  }
  if (query.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Forms</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <AlertLive>Unable to load forms.</AlertLive>
          <div>
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }
  const forms = query.data ?? []
  if (forms.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Forms</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusLive>No forms yet.</StatusLive>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Forms</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {forms.map((form) => (
            <li key={form.formId}>
              <Link
                to="/admin/forms/$formId"
                params={{ formId: form.formId }}
                search={{ eventSlug: slug }}
                className="inline-flex min-h-6 min-w-6 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {form.slug}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

interface EventConfigFormProps {
  readonly dto: AdminEventConfigDto
  readonly save: ReturnType<typeof useUpdateEventConfig>
  readonly slug: string
  readonly navigateToLogin: () => void
}

type SaveState =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string }

function EventConfigForm({ dto, save, slug, navigateToLogin }: EventConfigFormProps) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<EventConfigValues>({ defaultValues: toFormValues(dto) })
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

  const onSubmit = (values: EventConfigValues) => {
    setSavedMessage(null)
    setSaveState(null)
    const parsed = eventConfigSchema.safeParse(values)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue !== undefined) {
        const path = issue.path.join('.') as FieldPath<EventConfigValues>
        setError(path, { type: 'manual', message: issue.message })
        setFocus(path)
      }
      return
    }
    save.mutate(buildPatch(parsed.data, dirtyFields), {
      onSuccess: (server) => {
        reset(toFormValues(server))
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

  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-base leading-snug font-medium">Event settings</h1>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <Field label="Name" htmlFor="config-name" error={errors.name?.message}>
            <Input
              id="config-name"
              aria-invalid={errors.name !== undefined ? true : undefined}
              {...register('name')}
            />
          </Field>
          <Field label="Timezone" htmlFor="config-timezone" error={errors.timezone?.message}>
            <Input
              id="config-timezone"
              aria-invalid={errors.timezone !== undefined ? true : undefined}
              {...register('timezone')}
            />
          </Field>
          <div className="grid gap-1.5">
            <span id="config-status-label">Status</span>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-labelledby="config-status-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <Field label="Website" htmlFor="config-website" error={errors.websiteUrl?.message}>
            <Input
              id="config-website"
              aria-invalid={errors.websiteUrl !== undefined ? true : undefined}
              {...register('websiteUrl')}
            />
          </Field>
          <Field
            label="Organizer contact"
            htmlFor="config-contact"
            error={errors.organizerContact?.message}
          >
            <Input
              id="config-contact"
              aria-invalid={errors.organizerContact !== undefined ? true : undefined}
              {...register('organizerContact')}
            />
          </Field>
          <Field label="Venue" htmlFor="config-venue" error={errors.venue?.message}>
            <Input
              id="config-venue"
              aria-invalid={errors.venue !== undefined ? true : undefined}
              {...register('venue')}
            />
          </Field>
          <Field label="Event type" htmlFor="config-type" error={errors.eventType?.message}>
            <Input
              id="config-type"
              aria-invalid={errors.eventType !== undefined ? true : undefined}
              {...register('eventType')}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts at" htmlFor="config-starts" error={errors.startsAt?.message}>
              <Input
                id="config-starts"
                type="datetime-local"
                aria-invalid={errors.startsAt !== undefined ? true : undefined}
                {...register('startsAt')}
              />
            </Field>
            <Field label="Ends at" htmlFor="config-ends" error={errors.endsAt?.message}>
              <Input
                id="config-ends"
                type="datetime-local"
                aria-invalid={errors.endsAt !== undefined ? true : undefined}
                {...register('endsAt')}
              />
            </Field>
          </div>
          {saveState !== null ? (
            saveState.kind === 'forbidden' ? (
              <AlertLive>Access forbidden.</AlertLive>
            ) : saveState.kind === 'denied' ? (
              <AlertLive>Not found.</AlertLive>
            ) : (
              <AlertLive>{saveState.message}</AlertLive>
            )
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <Button
              type="submit"
              disabled={save.isPending}
              aria-label={save.isPending ? 'Saving…' : 'Save'}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {savedMessage !== null ? <StatusLive>{savedMessage}</StatusLive> : null}
          </div>
          <Link
            to="/admin/events/$slug/taxonomies"
            params={{ slug }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Manage taxonomies
          </Link>
        </form>
      </CardContent>
    </Card>
  )
}

function buildPatch(
  data: EventConfigValues,
  dirty: {
    readonly name?: boolean
    readonly timezone?: boolean
    readonly status?: boolean
    readonly websiteUrl?: boolean
    readonly organizerContact?: boolean
    readonly venue?: boolean
    readonly eventType?: boolean
    readonly startsAt?: boolean
    readonly endsAt?: boolean
  },
): UpdateEventConfigInput {
  const patch: MutableEventConfigPatch = {}
  const optionalString = (value: string): string | null =>
    value.trim().length === 0 ? null : value.trim()
  if (dirty.name !== undefined) patch.name = data.name.trim()
  if (dirty.timezone !== undefined) patch.timezone = data.timezone.trim()
  if (dirty.status !== undefined) patch.status = data.status
  if (dirty.websiteUrl !== undefined) patch.websiteUrl = optionalString(data.websiteUrl)
  if (dirty.organizerContact !== undefined)
    patch.organizerContact = optionalString(data.organizerContact)
  if (dirty.venue !== undefined) patch.venue = optionalString(data.venue)
  if (dirty.eventType !== undefined) patch.eventType = optionalString(data.eventType)
  if (dirty.startsAt !== undefined || dirty.endsAt !== undefined) {
    const startsAt = localInputToIso(data.startsAt)
    const endsAt = localInputToIso(data.endsAt)
    patch.dates =
      startsAt === null && endsAt === null
        ? null
        : { startsAt: startsAt ?? '', endsAt: endsAt ?? '' }
  }
  return patch
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  readonly label: string
  readonly htmlFor: string
  readonly error: string | undefined
  readonly children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error !== undefined ? <AlertLive>{error}</AlertLive> : null}
    </div>
  )
}
