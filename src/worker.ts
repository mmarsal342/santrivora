import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { authMiddleware, errorHandler, rateLimitMiddleware, securityHeadersMiddleware } from './middleware'
import { authRoutes } from './routes/auth'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

// Security & middleware (execution order matters)
app.use('*', securityHeadersMiddleware())
app.use('*', cors())
app.use('*', logger())
app.use('*', errorHandler())
app.use('*', rateLimitMiddleware())

// Public routes
app.route('/api/auth', authRoutes)

// Protected routes (require authentication)
// app.use('/api/*', authMiddleware())

// Health check
app.get('/health', (c) => c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString()
}))

// 404 handler
app.notFound((c) => c.json({
    error: 'Not Found',
    code: 'NOT_FOUND',
    message: 'Endpoint tidak ditemukan'
}, 404))

export default app