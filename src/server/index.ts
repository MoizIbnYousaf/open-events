import { Hono } from 'hono'

import type { ServerEnv } from './env'
import { handleError, handleNotFound } from './error'
import { registerAdminRoutes } from './routes/admin'
import { registerDevRoutes } from './routes/dev'
import { registerPublicRoutes } from './routes/public'

const app = new Hono<ServerEnv>()

app.onError(handleError)
app.notFound(handleNotFound)

registerPublicRoutes(app)
registerAdminRoutes(app)
registerDevRoutes(app)

export default app
