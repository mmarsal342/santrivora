import { Context, Next } from 'hono'
import type { ApiError, Env } from '../types'

export const securityHeadersMiddleware = () => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
    c.header('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'; " +
      "form-action 'self'")
    c.header('X-XSS-Protection', '1; mode=block')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('X-Frame-Options', 'DENY')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')

    await next()
  }
}

export const errorHandler = () => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      await next()
    } catch (err: unknown) {
      console.error('Internal Error:', {
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
        path: c.req.path,
        method: c.req.method,
        requestId: c.req.header('CF-Ray') || crypto.randomUUID()
      })

      const errorResponse: ApiError = {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: c.env.ENVIRONMENT === 'production'
          ? 'Terjadi kesalahan internal. Silakan coba lagi.'
          : err instanceof Error ? err.message : 'Unknown error',
        requestId: c.req.header('CF-Ray')
      }

      return c.json(errorResponse, 500)
    }
  }
}

export const rateLimitMiddleware = () => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const path = c.req.path
    const method = c.req.method

    if (method === 'OPTIONS') {
      await next()
      return
    }

    try {
      const clientIP = c.req.header('CF-Connecting-IP') || 'unknown'

      let config = { window: 60, max: 100 }
      if (path === '/api/auth/login') {
        config = { window: 60, max: 10 }
      } else if (path === '/api/auth/register') {
        config = { window: 3600, max: 3 }
      } else if (path === '/api/auth/refresh') {
        config = { window: 60, max: 20 }
      }

      const windowStart = Math.floor(Date.now() / 1000 / config.window) * config.window
      const key = `ratelimit:${path}:${clientIP}:${windowStart}`
      const currentCount = parseInt((await c.env.KV.get(key)) || '0')

      if (currentCount >= config.max) {
        const retryAfter = config.window - (Math.floor(Date.now() / 1000) - windowStart)
        c.header('Retry-After', String(Math.ceil(retryAfter)))
        return c.json({
          error: 'Too Many Requests',
          code: 'RATE_LIMITED',
          message: 'Terlalu banyak permintaan. Coba lagi nanti.',
          retryAfter: Math.ceil(retryAfter)
        } as ApiError, 429)
      }

      await c.env.KV.put(key, String(currentCount + 1), { expirationTtl: config.window })

      c.header('X-RateLimit-Limit', String(config.max))
      c.header('X-RateLimit-Remaining', String(config.max - currentCount - 1))
      c.header('X-RateLimit-Reset', String(windowStart + config.window))

      await next()
    } catch (err) {
      console.error('Rate limiter error:', err)
      await next()
    }
  }
}