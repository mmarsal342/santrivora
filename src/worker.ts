import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors, errorHandler, rateLimitMiddleware, securityHeadersMiddleware, ALLOWED_ORIGINS } from './middleware'
import { authRoutes } from './routes/auth'
import { adminRoutes } from './routes/admin'
import { kelasRoutes } from './routes/kelas'
import { santriRoutes } from './routes/santri'
import { kategoriRoutes } from './routes/kategori'
import { catatanRoutes } from './routes/catatan'
import { dashboardRoutes } from './routes/dashboard'
import { syncRoutes } from './routes/sync'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', securityHeadersMiddleware())
app.use('/api/*', cors({
  origin: ALLOWED_ORIGINS,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400
}))
app.use('/api/*', logger())
app.use('/api/*', errorHandler())
app.use('/api/*', rateLimitMiddleware())

app.route('/api/auth', authRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/kelas', kelasRoutes)
app.route('/api/santri', santriRoutes)
app.route('/api/kategori-pelanggaran', kategoriRoutes)
app.route('/api/catatan', catatanRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/sync', syncRoutes)

// Health check
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString()
  })
)

// SPA fallback: serve frontend assets for non-API routes
app.get('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw)
})

export default app