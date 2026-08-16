import { useCallback, useEffect, useState } from 'react'
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
import { PageHeaderTitle } from '../../../components/ui/page-header'
import { StatusLive } from '../../../components/ui/status-live'
import TurnstileWidget from './TurnstileWidget'
import { turnstileClientConfiguration } from '../../../lib/turnstile'

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
  const [acceptedGuidance, setAcceptedGuidance] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), [])
  const turnstile = turnstileClientConfiguration()
  const challengeUnavailable = turnstile.state === 'unavailable'

  const start = useServerMutation({
    mutationFn: (values: StartValues) =>
      startSession(values.email, eventSlug, formSlug, turnstileToken),
    onSuccess: (response) => {
      setAcceptedGuidance(response.guidance)
      setErrorMessage(null)
      setTurnstileToken('')
      setTurnstileResetKey((value) => value + 1)
    },
    onError: (error) => {
      setTurnstileToken('')
      setTurnstileResetKey((value) => value + 1)
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
    if (start.isPending || challengeUnavailable) return
    if (turnstile.required && turnstileToken.length === 0) return
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
    setAcceptedGuidance(null)
    start.mutate(parsed.data)
  }

  const pending = start.isPending
  // One summary, one live region. The transport error and the field error are
  // never both meaningful at once, and FieldError is deliberately not live, so
  // this is the single node that speaks.
  const summary = errorMessage ?? errors.email?.message ?? null

  return (
    <Card className="py-4" data-tour="start-page">
      <CardHeader>
        {/* The organizer door (`/admin`) and this one are meant to read as
            one family, and a comment over there says so. They did not: that
            card's title was a `PageHeaderTitle` at 20px/600 and this one was a
            hand-written h1 at 16px/500. Same primitive, same size, one door
            grammar. */}
        <PageHeaderTitle>Start</PageHeaderTitle>
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
          {turnstile.state === 'ready' ? (
            <TurnstileWidget onToken={onTurnstileToken} resetKey={turnstileResetKey} />
          ) : null}
          {challengeUnavailable ? (
            <AlertLive>
              Human verification is temporarily unavailable. Try again later or contact the event
              organizer.
            </AlertLive>
          ) : null}
          {summary !== null ? <AlertLive>{summary}</AlertLive> : null}
          {/* Mounted with the form and empty until the request is accepted: a
              region whose text changes, never one created together with its
              text — a polite live region has to be in the accessibility tree
              before its content arrives or it announces nothing (DEC-014). */}
          <StatusLive aria-live="polite">{acceptedGuidance}</StatusLive>
          {/* Stacked and full width, the way the organizer door's one control
              already stands: on a card this narrow a button sized to its own
              label is a small target floating in a wide row, and the two doors
              are meant to read as one family. */}
          <div className="grid gap-3">
            {/* The visible text is the accessible name. The old aria-label
                said "Start" while the button read "Request a link", which
                breaks WCAG 2.5.3 Label in Name. */}
            <Button
              type="submit"
              className="w-full"
              pending={pending}
              disabled={challengeUnavailable || (turnstile.required && turnstileToken.length === 0)}
            >
              {pending ? 'Sending…' : 'Request a link'}
            </Button>
            {errorMessage !== null ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                pending={pending}
                disabled={
                  challengeUnavailable || (turnstile.required && turnstileToken.length === 0)
                }
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
