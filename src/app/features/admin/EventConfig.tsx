import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Controller, useForm, type FieldPath } from 'react-hook-form'
import { z } from 'zod'

import { getApiErrorCode, getApiErrorMessage, requestJson } from '../../api/admin-events'
import {
  useEventConfig,
  useFormsList,
  useUpdateEventConfig,
  useUpdateFormWindow,
} from '../../queries/admin-events'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldError, FieldLabel, FieldTriggerLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { linkVariants } from '../../../components/ui/link-variants'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { Skeleton } from '../../../components/ui/skeleton'
import { DocumentStackIcon } from '../../../components/ui/icons'
import { StatusLive } from '../../../components/ui/status-live'
import type {
  AdminEventConfigDto,
  UpdateEventConfigInput,
} from '../../../application/dtos/event-config.dto'
import type { FormSummaryDto } from '../../../application/dtos/form-definition.dto'
import type { EventSlug } from '../../../domain/event'
import { EVENT_STATUSES } from '../../../domain/event'

import AppShell from '../nav/AppShell'
import EventBrandingCard from './EventBrandingCard'
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
    document.title = 'Event settings — Open Events'
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
      <div className="mx-auto w-full max-w-3xl">
        {/* The skeleton takes the shape of the page it precedes — a heading
            line, then a field stack — so the layout does not jump when the
            data lands. */}
        <Card aria-busy="true" aria-label="Loading event settings">
          <CardContent className="grid gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
            <StatusLive aria-live="polite">Loading event settings…</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <AppShell slug={slug ?? ''}>
      {/* Forms read at a measure, not at the width of a monitor.

          The gap between the cards is wider than the gap between the rows
          inside them, because two levels of structure need two spacing
          signals: at 12px outside and 12px in, five bordered cards read as one
          undifferentiated column of boxes and the hairlines do all the work
          alone. The floor underneath is the other half of the same idea — the
          last card used to sit flush against the bottom of the viewport, which
          reads as a page that was cut off rather than one that ended. */}
      <div className="mx-auto grid w-full max-w-3xl gap-4 pb-20 lg:gap-6">
        <EventConfigForm
          key={configQuery.data.id}
          dto={configQuery.data}
          forms={formsQuery.data ?? []}
          save={save}
          navigateToLogin={() => void navigate({ to: '/admin' })}
        />
        <EventBrandingCard
          slug={slug ?? ''}
          logoUrl={configQuery.data.logoUrl}
          logoWidth={configQuery.data.logoWidth}
          logoHeight={configQuery.data.logoHeight}
          backgroundUrl={configQuery.data.backgroundUrl}
          backgroundWidth={configQuery.data.backgroundWidth}
          backgroundHeight={configQuery.data.backgroundHeight}
          onChanged={() => configQuery.refetch().then(() => undefined)}
        />
        <FormsList query={formsQuery} slug={slug ?? ''} />
        <CfpSettings query={formsQuery} slug={slug ?? ''} />
        <ConfirmationTemplateCard slug={slug ?? ''} />
        <PublicLinks query={formsQuery} slug={slug ?? ''} />
        <ManageLinks slug={slug ?? ''} />
      </div>
    </AppShell>
  )
}

/**
 * A card section title. `CardTitle` renders a div, and these sections are real
 * document structure under the page's single h1 — so the heading level is
 * handed to the primitive's `render` escape rather than reproduced by a
 * hand-written h2 wearing a copy of the card's class string.
 */
/**
 * CFP settings: when the call accepts proposals.
 *
 * The window was enforced from the first release and settable nowhere, so the
 * public portal announced a close date no organizer could move. It sits on the
 * event settings page beside the forms it governs, because "when does my call
 * close" is a question about the event, not about a form's questions.
 *
 * Dates are typed as UTC instants — the same wire format the rest of the product
 * uses — and the server validates them; this card does not re-implement the
 * ordering rule, it reports what the server says about it.
 */
function ConfirmationTemplateCard({ slug }: { readonly slug: EventSlug }) {
  const template = useQuery({
    queryKey: ['admin', 'events', slug, 'confirmation-template'],
    queryFn: () =>
      requestJson<{ subject: string; body: string }>(
        `/api/admin/events/${slug}/confirmation-template`,
      ),
    enabled: slug.length > 0,
  })
  const [subject, setSubject] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      requestJson(`/api/admin/events/${slug}/confirmation-template`, {
        method: 'PUT',
        body: JSON.stringify({
          subject: subject ?? template.data?.subject ?? '',
          body: body ?? template.data?.body ?? '',
        }),
      }),
  })
  const subjectValue = subject ?? template.data?.subject ?? ''
  const bodyValue = body ?? template.data?.body ?? ''
  if (slug.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <SectionTitle>Submission confirmation</SectionTitle>
        <CardDescription>
          Email sent when a proposal is submitted. Use {'{{title}}'}, {'{{eventName}}'} and{' '}
          {'{{submissionId}}'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field>
          <FieldLabel htmlFor="confirmation-subject">Subject</FieldLabel>
          <Input
            id="confirmation-subject"
            value={subjectValue}
            onChange={(event) => setSubject(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="confirmation-body">Message</FieldLabel>
          <textarea
            id="confirmation-body"
            className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            value={bodyValue}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <Button
          type="button"
          className="self-start"
          pending={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isSuccess ? 'Confirmation saved' : 'Save confirmation'}
        </Button>
      </CardContent>
    </Card>
  )
}

function CfpSettings({
  query,
  slug,
}: {
  readonly query: ReturnType<typeof useFormsList>
  readonly slug: EventSlug
}) {
  const forms = query.data ?? []
  const form = forms[0]
  if (form === undefined) return null
  return <CfpWindowForm slug={slug} formId={form.formId} form={form} />
}

function CfpWindowForm({
  slug,
  formId,
  form,
}: {
  readonly slug: EventSlug
  readonly formId: string
  readonly form: FormSummaryDto
}) {
  const update = useUpdateFormWindow(slug, formId)
  const [opensAt, setOpensAt] = useState(form.opensAt ?? '')
  const [closesAt, setClosesAt] = useState(form.closesAt ?? '')
  const [message, setMessage] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <SectionTitle>Call for papers settings</SectionTitle>
        <CardDescription>
          When this call accepts proposals. Speakers see the close date on the public portal, and
          submissions and edits stop once it passes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (update.isPending) return
            setMessage(null)
            update.mutate(
              {
                opensAt: opensAt.trim() === '' ? null : opensAt.trim(),
                closesAt: closesAt.trim() === '' ? null : closesAt.trim(),
              },
              {
                onSuccess: () => setMessage('Saved'),
                onError: (error) =>
                  setMessage(getApiErrorMessage(error, 'Unable to save the submission window.')),
              },
            )
          }}
          noValidate
        >
          <Field>
            <FieldLabel htmlFor="cfp-opens-at">Submissions open</FieldLabel>
            <Input
              id="cfp-opens-at"
              value={opensAt}
              placeholder="2026-01-01T00:00:00.000Z"
              onChange={(event) => setOpensAt(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cfp-closes-at">Submissions close</FieldLabel>
            <Input
              id="cfp-closes-at"
              value={closesAt}
              placeholder="2026-12-31T23:59:59.000Z"
              onChange={(event) => setClosesAt(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" pending={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save CFP settings'}
            </Button>
            {/* Mounted with the form and empty until there is something to say,
                so the polite region is in the tree before its text arrives. */}
            <StatusLive aria-live="polite" aria-label="Call for papers settings status">
              {update.isPending ? null : message}
            </StatusLive>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function SectionTitle({ children }: { readonly children: ReactNode }) {
  return <CardTitle level={2}>{children}</CardTitle>
}

/**
 * One hairline-separated stack: rows divide, they do not stripe.
 *
 * Top rule only. `border-y` drew a closing rule under the last row, and the
 * card still applied its own 12px bottom padding under that — so every list
 * card ended with a hairline floating 12px above the card's own border, which
 * reads as a row that failed to render.
 */
function ListRows({ children }: { readonly children: ReactNode }) {
  return <ul className="-mx-3 divide-y divide-border border-t border-border">{children}</ul>
}

function ListRow({ children }: { readonly children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 hover:bg-foreground/[0.03]">{children}</li>
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
          <SectionTitle>Forms</SectionTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
          <StatusLive aria-live="polite">Loading forms…</StatusLive>
        </CardContent>
      </Card>
    )
  }
  if (query.isError) {
    return (
      <Card>
        <CardHeader>
          <SectionTitle>Forms</SectionTitle>
        </CardHeader>
        <CardContent className="grid justify-items-start gap-3">
          <AlertLive>Unable to load forms.</AlertLive>
          <Button
            type="button"
            variant="outline"
            size="sm"
            pending={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Trying again…' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
    )
  }
  const forms = query.data ?? []
  if (forms.length === 0) {
    return (
      <Card>
        <CardHeader>
          <SectionTitle>Forms</SectionTitle>
        </CardHeader>
        <CardContent>
          {/* Nothing here is passive — an organizer cannot create a form from
              this screen — so the copy stays neutral rather than issuing an
              instruction the page cannot carry out. */}
          <EmptyState
            icon={<DocumentStackIcon size={20} />}
            title={
              <StatusLive aria-live="polite" aria-label="No forms" className="text-foreground">
                No forms yet.
              </StatusLive>
            }
            description="A call-for-papers form is what puts this event in front of speakers."
          />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <SectionTitle>Forms</SectionTitle>
      </CardHeader>
      <CardContent>
        <ListRows>
          {forms.map((form) => (
            <ListRow key={form.formId}>
              <Link
                to="/admin/events/$slug/forms/$formId"
                params={{ slug, formId: form.formId }}
                className={linkVariants({ hit: true })}
              >
                {form.slug}
              </Link>
            </ListRow>
          ))}
        </ListRows>
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
        <SectionTitle>Public links</SectionTitle>
      </CardHeader>
      <CardContent>
        <ListRows>
          {published.map((form) => (
            <ListRow key={form.formId}>
              <Link
                to="/cfp/$eventSlug/$formSlug"
                params={{ eventSlug: slug, formSlug: form.slug }}
                className={linkVariants({ hit: true })}
              >
                Call for papers — {form.slug}
              </Link>
            </ListRow>
          ))}
          <ListRow>
            <Link
              to="/schedule/$eventSlug"
              params={{ eventSlug: slug }}
              className={linkVariants({ hit: true })}
            >
              Public schedule
            </Link>
          </ListRow>
        </ListRows>
      </CardContent>
    </Card>
  )
}

/**
 * The three sibling organizer surfaces that hang off this event. They are in
 * the rail too, but the settings page is where an organizer forms their mental
 * model of what an event owns, so the cross-links live here as well.
 */
function ManageLinks({ slug }: { readonly slug: string }) {
  return (
    <Card>
      <CardHeader>
        <SectionTitle>Manage</SectionTitle>
      </CardHeader>
      <CardContent>
        <ListRows>
          <ListRow>
            <Link
              to="/admin/events/$slug/taxonomies"
              params={{ slug }}
              className={linkVariants({ hit: true })}
            >
              Manage taxonomies
            </Link>
          </ListRow>
          <ListRow>
            <Link
              to="/admin/events/$slug/readiness"
              params={{ slug }}
              className={linkVariants({ hit: true })}
            >
              Speaker readiness
            </Link>
          </ListRow>
          <ListRow>
            <Link
              to="/admin/events/$slug/evaluations"
              params={{ slug }}
              className={linkVariants({ hit: true })}
            >
              Manage review committee
            </Link>
          </ListRow>
        </ListRows>
      </CardContent>
    </Card>
  )
}

interface EventConfigFormProps {
  readonly dto: AdminEventConfigDto
  readonly forms: readonly FormSummaryDto[]
  readonly save: ReturnType<typeof useUpdateEventConfig>
  readonly navigateToLogin: () => void
}

type SaveState =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string }

function EventConfigForm({ dto, forms, save, navigateToLogin }: EventConfigFormProps) {
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
        // No announce(): the header chip beside the Save button IS a live
        // region, and it is already saying this. Calling the announcer too
        // spoke one outcome twice (DEC-014, F-R3-13). The chip is the one that
        // stays — it carries the in-flight state as well, it sits where the
        // reader's focus already is, and it is what the golden journey reads.
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
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3" noValidate>
      {/* The page title is chrome: it sits in a row with the action it belongs
          to, not floating above the content at twice the size. */}
      <PageHeader className="min-h-8">
        <PageHeaderContent>
          <PageHeaderTitle>Event settings</PageHeaderTitle>
          <PageHeaderDescription>{dto.name}</PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          {/* One stable region for both outcomes, mounted before either has
              anything to say: a live region created together with its text
              is not in the accessibility tree when the text arrives, so it
              announces nothing. The saved chip is cleared at submit, so the
              in-flight message never overwrites a live one. */}
          <StatusLive aria-live="polite" aria-label="Event settings status" className="text-xs">
            {save.isPending ? 'Saving the event settings…' : savedMessage}
          </StatusLive>
          {/* The visible label is the accessible name; a duplicate
              aria-label only risks the two drifting apart. */}
          <Button type="submit" pending={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </PageHeaderActions>
      </PageHeader>
      {summaryMessage !== null ? <AlertLive>{summaryMessage}</AlertLive> : null}
      <EventOverview dto={dto} forms={forms} />
      <Card>
        <CardHeader>
          <SectionTitle>Details</SectionTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldTriggerLabel id="config-status-label">Status</FieldTriggerLabel>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    {/* `w-full`: the trigger sizes to its content by
                        default, so "Status" rendered a 73px control beside a
                        366px "Event type" input on the same row while every
                        other control in the card filled its cell. */}
                    <SelectTrigger className="w-full" aria-labelledby="config-status-label">
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
            <Field invalid={errors.eventType !== undefined}>
              <FieldLabel htmlFor="config-type">Event type</FieldLabel>
              <Input id="config-type" {...register('eventType')} />
              {errors.eventType !== undefined ? (
                <FieldError id="config-type-error">{errors.eventType.message}</FieldError>
              ) : null}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field invalid={errors.timezone !== undefined}>
              <FieldLabel htmlFor="config-timezone">Timezone</FieldLabel>
              <Input id="config-timezone" {...register('timezone')} />
              {errors.timezone !== undefined ? (
                <FieldError id="config-timezone-error">{errors.timezone.message}</FieldError>
              ) : null}
            </Field>
            <Field invalid={errors.venue !== undefined}>
              <FieldLabel htmlFor="config-venue">Venue</FieldLabel>
              <Input id="config-venue" autoComplete="off" {...register('venue')} />
              {errors.venue !== undefined ? (
                <FieldError id="config-venue-error">{errors.venue.message}</FieldError>
              ) : null}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <SectionTitle>Dates</SectionTitle>
          <CardDescription>
            Both dates travel together: an event with only one of them is not a date at all.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
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
        </CardContent>
      </Card>
    </form>
  )
}

function EventOverview({
  dto,
  forms,
}: {
  readonly dto: AdminEventConfigDto
  readonly forms: readonly FormSummaryDto[]
}) {
  const publishedForms = forms.filter((form) => form.publishedVersionId !== null)
  const primaryForm = publishedForms[0]
  const [now] = useState(() => Date.now())
  const cfpState =
    primaryForm === undefined
      ? 'No published form'
      : primaryForm.opensAt !== null && new Date(primaryForm.opensAt).getTime() > now
        ? 'Scheduled'
        : primaryForm.closesAt !== null && new Date(primaryForm.closesAt).getTime() < now
          ? 'Closed'
          : 'Open now'
  const formCount = `${publishedForms.length} published form${publishedForms.length === 1 ? '' : 's'}`

  return (
    <section
      role="region"
      aria-label="Event overview"
      data-tour="event-overview"
      className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:p-4"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <OverviewFact label="Event status" value={capitalize(dto.status)} />
        <OverviewFact label="Submission forms" value={formCount} />
        <OverviewFact label="Call for papers" value={cfpState} />
      </div>
      <nav aria-label="Event workflow" className="grid gap-2 sm:grid-cols-3">
        <OverviewLink slug={dto.slug} path="submissions" label="Review submissions" />
        <OverviewLink slug={dto.slug} path="readiness" label="Track speaker readiness" />
        <OverviewLink slug={dto.slug} path="agenda" label="Build the agenda" />
      </nav>
    </section>
  )
}

function OverviewFact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid gap-0.5 rounded-md border bg-background px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

function OverviewLink({
  slug,
  path,
  label,
}: {
  readonly slug: EventSlug
  readonly path: 'submissions' | 'readiness' | 'agenda'
  readonly label: string
}) {
  return (
    <Link
      to={`/admin/events/$slug/${path}`}
      params={{ slug }}
      className="flex min-h-10 items-center justify-between rounded-md border bg-background px-3 text-sm font-medium text-link outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      <span aria-hidden="true">&#8594;</span>
    </Link>
  )
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`
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
