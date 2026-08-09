import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { getApiErrorMessage } from '../../api/admin-events'
import { useAdminLogin } from '../../queries/admin-events'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'

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
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ defaultValues: { secret: '' } })

  useEffect(() => {
    setFocus('secret')
  }, [setFocus])

  useEffect(() => {
    document.title = 'Admin sign in — SpeakerOps'
  }, [])

  const onSubmit = (values: LoginValues) => {
    const parsed = loginSchema.safeParse(values)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue !== undefined) {
        setError('secret', { type: 'manual', message: issue.message })
        setFocus('secret')
      }
      return
    }
    login.mutate(parsed.data.secret, {
      onSuccess: () => {
        void navigate({ to: '/admin/events/$slug', params: { slug: 'demo-conf-2026' } })
      },
      onError: (error) => {
        setError('secret', {
          type: 'server',
          message: getApiErrorMessage(error, 'Unable to sign in'),
        })
      },
    })
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <h1 className="font-heading text-base leading-snug font-medium">Admin sign in</h1>
        <CardDescription>Sign in to manage the event.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="organizer-secret">Organizer secret</label>
            <Input
              id="organizer-secret"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.secret !== undefined ? true : undefined}
              aria-describedby={errors.secret !== undefined ? 'login-secret-error' : undefined}
              {...register('secret')}
            />
            {errors.secret !== undefined ? (
              <AlertLive id="login-secret-error">{errors.secret.message}</AlertLive>
            ) : null}
          </div>
          <Button type="submit" disabled={isSubmitting}>
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
