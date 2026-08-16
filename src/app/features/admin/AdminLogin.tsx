import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { isClerkConfigured } from '../../../lib/clerk'
import { ApiClientError, getApiErrorMessage } from '../../api/admin-events'
import { useAdminLogin } from '../../queries/admin-events'
import { DEFAULT_EVENT_SLUG } from '../../lib/default-event'
import { isTourActive } from '../tour/tour-activity'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '../../../components/ui/card'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { PageHeaderTitle } from '../../../components/ui/page-header'
import { StatusLive } from '../../../components/ui/status-live'

const ClerkOrganizerAuth = lazy(() => import('./ClerkOrganizerAuth'))

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
    // The one caller this page does not serve: the product tour, which narrates
    // this screen from its own popover and arrives here by navigating, not by a
    // person asking for the field. Taking focus then emptied the popover of
    // keyboard control and sent Escape into the input's scope instead of
    // dismissing the tour, leaving the tour keyboard-undismissable (F-R4-4).
    // Focus is only ours to take when the visitor came here to sign in.
    if (isTourActive()) return
    setFocus('secret')
  }, [setFocus])

  useEffect(() => {
    document.title = 'Admin sign in — Open Events'
  }, [])

  const enterWorkspace = useCallback(() => {
    toast.success('Signed in')
    void navigate({ to: '/admin/events/$slug', params: { slug: DEFAULT_EVENT_SLUG } })
  }, [navigate])

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
      onSuccess: enterWorkspace,
      onError: (error) => {
        const message =
          error instanceof ApiClientError && error.status === 429
            ? 'Too many sign-in attempts. Wait a few minutes, then try again.'
            : getApiErrorMessage(error, 'Unable to sign in')
        setFormError(message)
        setError('secret', { type: 'server', message })
      },
    })
  }

  return (
    // The gutter is INSIDE the measure, so the card itself lands at exactly
    // max-w-md — the width the speaker door already sits at, one column deeper
    // inside the public shell. The two doors were 416px and 448px wide, which
    // is close enough to look like a mistake and far enough to see.
    <div className="mx-auto w-full max-w-[30rem] px-4 py-16" data-tour="admin-signin">
      <Card className="py-4">
        <CardHeader>
          {/* The organizer door and the speaker door (`/start`) share this
              anatomy — one card, one field, one full-width action — so the two
              entrances to the product read as one family. */}
          <PageHeaderTitle>Admin sign in</PageHeaderTitle>
          <CardDescription>
            For event organizers. Speaker email links only open proposals and the speaker portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isClerkConfigured() ? (
            <div className="mb-4">
              <Suspense fallback={null}>
                <ClerkOrganizerAuth onAuthed={enterWorkspace} />
              </Suspense>
            </div>
          ) : null}
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
            <div className="grid gap-2">
              {/* Default height, not `lg`. This was the only h-9 control in
                  the entire product — C0 §3 reserves that step for large and
                  marketing surfaces — and it sat directly under a 32px input,
                  so the card had two control heights in three rows. */}
              <Button type="submit" className="w-full" pending={login.isPending}>
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
              {/* The in-flight state next to the control, not only on it: a
                disabled button's aria-busy is not reliably announced. */}
              {login.isPending ? (
                <StatusLive aria-live="polite" className="text-center text-xs">
                  Signing in…
                </StatusLive>
              ) : null}
            </div>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Submitting or speaking?{' '}
            <a className="font-medium text-foreground underline underline-offset-4" href="/start">
              Use email access
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
