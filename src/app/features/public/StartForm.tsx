import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { useServerMutation } from '../../../../adapters/tanstack-react-query'
import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import { startSession } from '../../api/public'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../../../components/ui/card'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { StatusLive } from '../../../components/ui/status-live'

const startSchema = z.object({
  email: z.string().min(1, 'Email is required'),
})

type StartValues = z.infer<typeof startSchema>

interface StartFormProps {
  readonly eventSlug: string
  readonly formSlug: string
}

export default function StartForm({ eventSlug, formSlug }: StartFormProps) {
  const {
    register,
    handleSubmit,
    setFocus,
    getValues,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<StartValues>({
    defaultValues: { email: '' },
  })
  const [accepted, setAccepted] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const start = useServerMutation({
    mutationFn: (values: StartValues) => startSession(values.email, eventSlug, formSlug),
    onSuccess: () => {
      setAccepted(true)
      setErrorMessage(null)
    },
    onError: (error) => {
      const code = getApiErrorCode(error)
      if (code === 'validation_failed') {
        // Clearing the server message is part of the one-alert invariant: the
        // field error below becomes the summary, and a stale transport error
        // must not stay live beside it.
        setErrorMessage(null)
        setError(
          'email',
          {
            type: 'server',
            message: 'Enter a valid email address',
          },
          { shouldFocus: true },
        )
        return
      }
      setErrorMessage(getApiErrorMessage(error, 'Unable to start'))
    },
  })

  useEffect(() => {
    setFocus('email')
  }, [setFocus])

  const onSubmit = (values: StartValues) => {
    if (start.isPending) return
    const parsed = startSchema.safeParse(values)
    if (!parsed.success) {
      // Without this the previous transport error stayed on screen next to the
      // new field error, so the form held two live regions at once.
      setErrorMessage(null)
      setError(
        'email',
        {
          type: 'client',
          message: 'Email is required',
        },
        { shouldFocus: true },
      )
      return
    }
    setErrorMessage(null)
    clearErrors('email')
    setAccepted(false)
    start.mutate(parsed.data)
  }

  const pending = start.isPending
  // One summary, one live region. The transport error and the field error are
  // never both meaningful at once, and FieldError is deliberately not live, so
  // this is the single node that speaks.
  const summary = errorMessage ?? errors.email?.message ?? null

  return (
    <Card data-tour="start-page">
      <CardHeader>
        <h1 className="font-heading text-base leading-snug font-medium">Start</h1>
        <CardDescription>Request a link to begin your proposal.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <Field invalid={errors.email !== undefined}>
            <FieldLabel htmlFor="start-email">Email</FieldLabel>
            <Input
              id="start-email"
              type="email"
              autoComplete="email"
              aria-invalid={errors.email !== undefined ? true : undefined}
              aria-describedby={errors.email !== undefined ? 'start-email-error' : undefined}
              {...register('email')}
            />
            {errors.email !== undefined ? (
              <FieldError id="start-email-error">{errors.email.message}</FieldError>
            ) : null}
          </Field>
          {summary !== null ? <AlertLive>{summary}</AlertLive> : null}
          {/* Mounted with the form and empty until the request is accepted: a
              region whose text changes, never one created together with its
              text — a polite live region has to be in the accessibility tree
              before its content arrives or it announces nothing (DEC-014). */}
          <StatusLive aria-live="polite">{accepted ? 'Check your email' : null}</StatusLive>
          <div className="flex flex-wrap items-center gap-3">
            {/* The visible text is the accessible name. The old aria-label
                said "Start" while the button read "Request a link", which
                breaks WCAG 2.5.3 Label in Name. */}
            <Button type="submit" pending={pending}>
              {pending ? 'Sending…' : 'Request a link'}
            </Button>
            {errorMessage !== null ? (
              <Button
                type="button"
                variant="outline"
                pending={pending}
                onClick={() => onSubmit(getValues())}
              >
                {pending ? 'Sending…' : 'Retry'}
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
