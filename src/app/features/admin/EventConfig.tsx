import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Controller, useForm, type FieldPath } from 'react-hook-form'
import { z } from 'zod'

import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import { announce } from '../../lib/announcer'
import { useEventConfig, useFormsList, useUpdateEventConfig } from '../../queries/admin-events'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, FieldError, FieldLabel, FieldTriggerLabel } from '../../../components/ui/field'
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
import type {
  AdminEventConfigDto,
  UpdateEventConfigInput,
} from '../../../application/dtos/event-config.dto'
import { EVENT_STATUSES } from '../../../domain/event'

import AppShell from '../nav/AppShell'
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
        pending={configQuery.isFetching}
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
          <StatusLive aria-live="polite">Loading event settings…</StatusLive>
        </CardContent>
      </Card>
    )
  }

  return (
    <AppShell slug={slug ?? ''}>
      <div className="grid gap-4">
        <EventConfigForm
          key={configQuery.data.id}
          dto={configQuery.data}
          save={save}
          slug={slug ?? ''}
          navigateToLogin={() => void navigate({ to: '/admin' })}
        />
        <FormsList query={formsQuery} slug={slug ?? ''} />
        <PublicLinks query={formsQuery} slug={slug ?? ''} />
      </div>
    </AppShell>
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
          <StatusLive aria-live="polite">Loading forms…</StatusLive>
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
            <Button
              type="button"
              variant="outline"
              pending={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? 'Trying again…' : 'Retry'}
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
          <StatusLive aria-live="polite" aria-label="No forms">
            No forms yet.
          </StatusLive>
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
                to="/admin/events/$slug/forms/$formId"
                params={{ slug, formId: form.formId }}
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

/**
 * The shareable public URLs for this event, rendered only once a form is
 * actually published — an organizer should never be handed a link that 404s.
 * Without this card the public CFP and schedule had no inbound link anywhere in
 * the product and could only be reached by typing a URL.
 */
function PublicLinks({
  query,
  slug,
}: {
  readonly query: ReturnType<typeof useFormsList>
  readonly slug: string
}) {
  const published = (query.data ?? []).filter((form) => form.publishedVersionId !== null)
  if (published.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Public links</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {published.map((form) => (
            <li key={form.formId}>
              <Link
                to="/cfp/$eventSlug/$formSlug"
                params={{ eventSlug: slug, formSlug: form.slug }}
                className="inline-flex min-h-6 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Call for papers — {form.slug}
              </Link>
            </li>
          ))}
          <li>
            <Link
              to="/schedule/$eventSlug"
              params={{ eventSlug: slug }}
              className="inline-flex min-h-6 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Public schedule
            </Link>
          </li>
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
        announce('Event settings saved')
      },
      onError: (error) => {
        const code = getApiErrorCode(error)
        if (code === 'forbidden') setSaveState({ kind: 'forbidden' })
        else if (code === 'not_found') setSaveState({ kind: 'denied' })
        else
          setSaveState({
            kind: 'error',
            message: getApiErrorMessage(error, 'Unable to save the event settings'),
          })
        // No announce(): the summary alert below renders this same message and
        // is already an assertive live region (DEC-014).
        if (code === 'unauthorized') {
          window.setTimeout(() => navigateToLogin(), 100)
        }
      },
    })
  }

  // Exactly one role=alert per form: the submit-level summary. Per-field text
  // is a FieldError referenced by the control's aria-describedby, so a screen
  // reader hears the problem once, on the field it belongs to.
  const summaryMessage =
    saveState !== null
      ? saveState.kind === 'forbidden'
        ? 'Access forbidden.'
        : saveState.kind === 'denied'
          ? 'Not found.'
          : saveState.message
      : Object.keys(errors).length > 0
        ? 'Please fix the highlighted fields.'
        : null

  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-base leading-snug font-medium">Event settings</h1>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          {/*
            Name / Website / Organizer contact / Venue describe the EVENT and
            are published on the public programme, so organization / url /
            email / street-address would be false input-purpose declarations
            (WCAG 1.3.5 covers the user's own data) and would invite the
            browser to inject the operator's employer, homepage, personal email
            and home address into fields whose values are published.
            react-hook-form's register() already ships name="name" on the first
            of them, which is one of the strongest full-name heuristics there
            is, so autoComplete="off" is a bug fix, not a suppression.
          */}
          <Field invalid={errors.name !== undefined}>
            <FieldLabel htmlFor="config-name">Name</FieldLabel>
            <Input id="config-name" autoComplete="off" {...register('name')} />
            {errors.name !== undefined ? (
              <FieldError id="config-name-error">{errors.name.message}</FieldError>
            ) : null}
          </Field>
          <Field invalid={errors.timezone !== undefined}>
            <FieldLabel htmlFor="config-timezone">Timezone</FieldLabel>
            <Input id="config-timezone" {...register('timezone')} />
            {errors.timezone !== undefined ? (
              <FieldError id="config-timezone-error">{errors.timezone.message}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldTriggerLabel id="config-status-label">Status</FieldTriggerLabel>
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
          </Field>
          <Field invalid={errors.websiteUrl !== undefined}>
            <FieldLabel htmlFor="config-website">Website</FieldLabel>
            <Input id="config-website" autoComplete="off" {...register('websiteUrl')} />
            {errors.websiteUrl !== undefined ? (
              <FieldError id="config-website-error">{errors.websiteUrl.message}</FieldError>
            ) : null}
          </Field>
          <Field invalid={errors.organizerContact !== undefined}>
            <FieldLabel htmlFor="config-contact">Organizer contact</FieldLabel>
            <Input id="config-contact" autoComplete="off" {...register('organizerContact')} />
            {errors.organizerContact !== undefined ? (
              <FieldError id="config-contact-error">{errors.organizerContact.message}</FieldError>
            ) : null}
          </Field>
          <Field invalid={errors.venue !== undefined}>
            <FieldLabel htmlFor="config-venue">Venue</FieldLabel>
            <Input id="config-venue" autoComplete="off" {...register('venue')} />
            {errors.venue !== undefined ? (
              <FieldError id="config-venue-error">{errors.venue.message}</FieldError>
            ) : null}
          </Field>
          <Field invalid={errors.eventType !== undefined}>
            <FieldLabel htmlFor="config-type">Event type</FieldLabel>
            <Input id="config-type" {...register('eventType')} />
            {errors.eventType !== undefined ? (
              <FieldError id="config-type-error">{errors.eventType.message}</FieldError>
            ) : null}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={errors.startsAt !== undefined}>
              <FieldLabel htmlFor="config-starts">Starts at</FieldLabel>
              <Input id="config-starts" type="datetime-local" {...register('startsAt')} />
              {errors.startsAt !== undefined ? (
                <FieldError id="config-starts-error">{errors.startsAt.message}</FieldError>
              ) : null}
            </Field>
            <Field invalid={errors.endsAt !== undefined}>
              <FieldLabel htmlFor="config-ends">Ends at</FieldLabel>
              <Input id="config-ends" type="datetime-local" {...register('endsAt')} />
              {errors.endsAt !== undefined ? (
                <FieldError id="config-ends-error">{errors.endsAt.message}</FieldError>
              ) : null}
            </Field>
          </div>
          {summaryMessage !== null ? <AlertLive>{summaryMessage}</AlertLive> : null}
          <div className="flex items-center justify-between gap-3">
            {/* The visible label is the accessible name; a duplicate
                aria-label only risks the two drifting apart. */}
            <Button type="submit" pending={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {/* One stable region for both outcomes, mounted before either has
                anything to say: a live region created together with its text
                is not in the accessibility tree when the text arrives, so it
                announces nothing. The saved chip is cleared at submit, so the
                in-flight message never overwrites a live one. */}
            <StatusLive aria-live="polite">
              {save.isPending ? 'Saving the event settings…' : savedMessage}
            </StatusLive>
          </div>
          <Link
            to="/admin/events/$slug/taxonomies"
            params={{ slug }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Manage taxonomies
          </Link>
          <Link
            to="/admin/events/$slug/readiness"
            params={{ slug }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Speaker readiness
          </Link>
          <Link
            to="/admin/events/$slug/evaluations"
            params={{ slug }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Manage review committee
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
