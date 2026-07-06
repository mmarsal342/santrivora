import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { errorHandler, rateLimitMiddleware, securityHeadersMiddleware } from './middleware'
import { authRoutes } from './routes/auth'
import { adminRoutes } from './routes/admin'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

app.use('*', securityHeadersMiddleware())
app.use('*', cors())
app.use('*', logger())
app.use('*', errorHandler())
app.use('*', rateLimitMiddleware())

app.route('/api/auth', authRoutes)
app.route('/api/admin', adminRoutes)

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString()
  })
)

app.notFound((c) =>
  c.json(
    {
      error: 'Not Found',
      code: 'NOT_FOUND',
      message: 'Endpoint tidak ditemukan.'
    },
    404
  )
)

export default app