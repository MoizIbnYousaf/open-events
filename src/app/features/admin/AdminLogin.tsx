import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { getApiErrorMessage } from '../../api/admin-events'
import { useAdminLogin } from '../../queries/admin-events'
import { DEFAULT_EVENT_SLUG } from '../../lib/default-event'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../../../components/ui/card'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { StatusLive } from '../../../components/ui/status-live'

const loginSchema = z.object({
  secret: z.string().min(1, 'Organizer secret is required'),
})

type LoginValues = z.infer<typeof loginSchema>

export default function AdminLogin() {
  const navigate = useNavigate()
  const login = useAdminLogin()
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<LoginValues>({ defaultValues: { secret: '' } })
  // The one live region on this form. FieldError carries the same sentence
  // next to the control but is deliberately not live, so the message is
  // announced exactly once.
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setFocus('secret')
  }, [setFocus])

  useEffect(() => {
    document.title = 'Admin sign in — SpeakerOps'
  }, [])

  const onSubmit = (values: LoginValues) => {
    // react-hook-form's isSubmitting settles in the same microtask because
    // this handler does not await the mutation, so login.isPending is the only
    // flag that actually covers the request.
    if (login.isPending) return
    const parsed = loginSchema.safeParse(values)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue !== undefined) {
        setFormError(issue.message)
        setError('secret', { type: 'manual', message: issue.message })
        setFocus('secret')
      }
      return
    }
    setFormError(null)
    login.mutate(parsed.data.secret, {
      // Nothing of this page survives the navigation, so the outcome is
      // reported on the one channel that does: the toaster the shell mounts
      // beside the router. Its region is already live, so this is the whole
      // announcement — a second channel would speak the same sentence twice
      // (DEC-014, DEC-019).
      onSuccess: () => {
        toast.success('Signed in')
        void navigate({ to: '/admin/events/$slug', params: { slug: DEFAULT_EVENT_SLUG } })
      },
      onError: (error) => {
        const message = getApiErrorMessage(error, 'Unable to sign in')
        setFormError(message)
        setError('secret', { type: 'server', message })
      },
    })
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16" data-tour="admin-signin">
      <Card>
        <CardHeader>
          <h1 className="font-heading text-base leading-snug font-medium">Admin sign in</h1>
          <CardDescription>Sign in to manage the event.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <Field invalid={errors.secret !== undefined}>
              <FieldLabel htmlFor="organizer-secret">Organizer secret</FieldLabel>
              <Input
                id="organizer-secret"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.secret !== undefined ? true : undefined}
                aria-describedby={errors.secret !== undefined ? 'login-secret-error' : undefined}
                {...register('secret')}
              />
              {errors.secret !== undefined ? (
                <FieldError id="login-secret-error">{errors.secret.message}</FieldError>
              ) : null}
            </Field>
            {formError !== null ? <AlertLive>{formError}</AlertLive> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" pending={login.isPending}>
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
              {/* The in-flight state next to the control, not only on it: a
                disabled button's aria-busy is not reliably announced. */}
              {login.isPending ? <StatusLive aria-live="polite">Signing in…</StatusLive> : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
