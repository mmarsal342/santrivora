import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { errorHandler, rateLimitMiddleware, securityHeadersMiddleware } from './middleware'
import { authRoutes } from './routes/auth'
import { adminRoutes } from './routes/admin'
import { kelasRoutes } from './routes/kelas'
import { santriRoutes } from './routes/santri'
import { kategoriRoutes } from './routes/kategori'
import { catatanRoutes } from './routes/catatan'
import { dashboardRoutes } from './routes/dashboard'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

app.use('*', securityHeadersMiddleware())
app.use('*', cors())
app.use('*', logger())
app.use('*', errorHandler())
app.use('*', rateLimitMiddleware())

app.route('/api/auth', authRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/kelas', kelasRoutes)
app.route('/api/santri', santriRoutes)
app.route('/api/kategori-pelanggaran', kategoriRoutes)
app.route('/api/catatan', catatanRoutes)
app.route('/api/dashboard', dashboardRoutes)

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString()
  })
)

app.get('/', (c) =>
  c.json({
    name: 'SantriVora API',
    version: '1.0.0',
    documentation: '/api',
    health: '/health'
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