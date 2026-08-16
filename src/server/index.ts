import { Hono } from 'hono'

import type { ServerEnv } from './env'
import { handleError, handleNotFound } from './error'
import { registerAdminRoutes } from './routes/admin'
import { registerDevRoutes } from './routes/dev'
import { registerPublicRoutes } from './routes/public'
import { registerSupportRoutes } from './routes/support'
import { registerResendWebhookRoutes } from './routes/resend-webhook'
import { registerAcceptanceResetRoutes } from './routes/acceptance-reset'
import { registerTourRoutes } from './routes/tour'
import { depsFromContext } from './container'
import { runScheduledEmailDrain, scheduleEmailDrain } from './email-drain'

const app = new Hono<ServerEnv>()

function applyBrowserSecurityHeaders(response: Response, path: string): Response {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  if (path.startsWith('/embed/')) {
    response.headers.set(
      'Content-Security-Policy',
      'frame-ancestors https: http://localhost:* http://127.0.0.1:*',
    )
    response.headers.delete('X-Frame-Options')
  } else {
    response.headers.set('Content-Security-Policy', "frame-ancestors 'none'")
    response.headers.set('X-Frame-Options', 'DENY')
  }
  return response
}

app.onError(handleError)
app.notFound(handleNotFound)

app.use('*', async (context, next) => {
  const servesStaticAsset =
    !context.req.path.startsWith('/api/') && !context.req.path.startsWith('/embed/')
  if (servesStaticAsset && context.env.ASSETS !== undefined) {
    const asset = await context.env.ASSETS.fetch(context.req.raw)
    const response = new Response(asset.body, asset)
    if (context.env.DEPLOY_ENVIRONMENT === 'acceptance') {
      response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    }
    return applyBrowserSecurityHeaders(response, context.req.path)
  }
  await next()
  applyBrowserSecurityHeaders(context.res, context.req.path)
  if (context.env.DEPLOY_ENVIRONMENT === 'acceptance') {
    context.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  }
})

app.use('/api/*', async (context, next) => {
  await next()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(context.req.method)) return
  // Only a successful mutation can have created fresh delivery work. Refused
  // or unknown requests must not become an unauthenticated drain trigger.
  if (context.res.status >= 400) return
  if (context.env.EMAIL_DELIVERY_MODE === 'capture') return
  const deps = depsFromContext(context)
  if (deps !== null) scheduleEmailDrain(context, deps)
})

registerPublicRoutes(app)
registerResendWebhookRoutes(app)
registerAcceptanceResetRoutes(app)
registerTourRoutes(app)
registerAdminRoutes(app)
registerSupportRoutes(app)
registerDevRoutes(app)

const worker = Object.assign(app, {
  scheduled(
    _controller: ScheduledController,
    env: ServerEnv['Bindings'],
    context: ExecutionContext,
  ) {
    context.waitUntil(
      runScheduledEmailDrain(env).catch(() => {
        console.error('email delivery scheduled drain failed')
      }),
    )
  },
})

export default worker
