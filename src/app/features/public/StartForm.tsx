import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'

import { getApiErrorCode, getApiErrorMessage } from '../../api/admin-events'
import { startSession } from '../../api/public'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../../../components/ui/card'
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

  const start = useMutation({
    mutationFn: (values: StartValues) => startSession(values.email, eventSlug, formSlug),
    onSuccess: () => {
      setAccepted(true)
      setErrorMessage(null)
    },
    onError: (error) => {
      const code = getApiErrorCode(error)
      if (code === 'validation_failed') {
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
    const parsed = startSchema.safeParse(values)
    if (!parsed.success) {
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

  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-base leading-snug font-medium">Start</h1>
        <CardDescription>Request a link to begin your proposal.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="start-email">Email</label>
            <Input
              id="start-email"
              type="email"
              autoComplete="email"
              aria-invalid={errors.email !== undefined ? true : undefined}
              aria-describedby={errors.email !== undefined ? 'start-email-error' : undefined}
              {...register('email')}
            />
            {errors.email !== undefined ? (
              <AlertLive id="start-email-error">{errors.email.message}</AlertLive>
            ) : null}
          </div>
          {errorMessage !== null ? <AlertLive>{errorMessage}</AlertLive> : null}
          {accepted ? <StatusLive>Check your email</StatusLive> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending} aria-label={pending ? 'Sending…' : 'Start'}>
              {pending ? 'Sending…' : 'Request a link'}
            </Button>
            {errorMessage !== null ? (
              <Button type="button" variant="outline" onClick={() => onSubmit(getValues())}>
                Retry
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
