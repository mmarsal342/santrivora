import { Next, Context } from 'hono'
import type { ApiError } from '../types'

// Security headers middleware
export const securityHeadersMiddleware = () => {
  return async (c: Context, next: Next) => {
    // HSTS
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')

    // CSP
    c.header('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'; " +
      "form-action 'self'")

    // XSS Protection
    c.header('X-XSS-Protection', '1; mode=block')

    // Content Type Options
    c.header('X-Content-Type-Options', 'nosniff')

    // Referrer Policy
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')

    // Frame Options
    c.header('X-Frame-Options', 'DENY')

    // Permissions Policy
    c.header('Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()')

    // Cache Control
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate')

    await next()
  }
}

// Global error handler
export const errorHandler = () => {
  return async (c: Context, next: Next) => {
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

// Rate limiter (KV-based)
export const rateLimitMiddleware = () => {
  return async (c: Context, next: Next) => {
    try {
      const path = c.req.path
      const clientIP = c.req.header('CF-Connecting-IP') || 'unknown'
      const key = `ratelimit:${path}:${clientIP}`

      // Basic rate limit: 100 requests per minute
      const windowStart = Math.floor(Date.now() / 1000 / 60) * 60
      const currentKey = `${key}:${windowStart}`

      const currentCount = parseInt((await c.env.KV.get(currentKey)) || '0')
      const maxRequests = 100

      if (currentCount >= maxRequests) {
        const retryAfter = 60 - (Date.now() / 1000 - windowStart)

        c.header('Retry-After', String(Math.ceil(retryAfter)))

        return c.json({
          error: 'Too Many Requests',
          code: 'RATE_LIMITED',
          message: 'Terlalu banyak permintaan. Coba lagi nanti',
          retryAfter: Math.ceil(retryAfter)
        } as ApiError, 429)
      }

      // Increment counter
      await c.env.KV.put(currentKey, String(currentCount + 1), {
        expirationTtl: 60
      })

      // Set rate limit headers
      c.header('X-RateLimit-Limit', String(maxRequests))
      c.header('X-RateLimit-Remaining', String(maxRequests - currentCount - 1))
      c.header('X-RateLimit-Reset', String(windowStart + 60))

      await next()
    } catch (err) {
      // If KV fails, allow request to proceed
      console.error('Rate limiter error:', err)
      await next()
    }
  }
}

// JWT auth middleware (placeholder for now)
export const authMiddleware = () => {
  return async (c: Context, next: Next) => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({
        error: 'Unauthorized',
        code: 'NO_TOKEN',
        message: 'Token tidak ditemukan'
      } as ApiError, 401)
    }

    // TODO: Verify token
    await next()
  }
}