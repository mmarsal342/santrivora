import { Context, Next } from 'hono'
import { verifyAccessToken } from '../services/auth'
import type { ApiError, Env, Role, UserPayload } from '../types'

declare module 'hono' {
  interface ContextVariableMap {
    user: UserPayload
  }
}

export const authMiddleware = async (c: Context<{ Bindings: Env; Variables: { user: UserPayload } }>, next: Next) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return c.json({
      error: 'Unauthorized',
      code: 'NO_TOKEN',
      message: 'Token tidak ditemukan. Silakan login terlebih dahulu.'
    } as ApiError, 401)
  }

  const payload = await verifyAccessToken(token, c.env.JWT_ACCESS_SECRET)

  if (!payload) {
    return c.json({
      error: 'Unauthorized',
      code: 'INVALID_TOKEN',
      message: 'Token tidak valid atau sudah kedaluwarsa.'
    } as ApiError, 401)
  }

  // Check if token is blacklisted
  const isBlacklisted = await c.env.KV.get(`blacklist:${payload.jti}`)
  if (isBlacklisted) {
    return c.json({
      error: 'Unauthorized',
      code: 'TOKEN_REVOKED',
      message: 'Sesi telah berakhir. Silakan login kembali.'
    } as ApiError, 401)
  }

  // Check if user has been suspended/locked (covers the access-token window after suspend)
  const userLocked = await c.env.KV.get(`blacklist:user:${payload.sub}`)
  if (userLocked) {
    return c.json({
      error: 'Unauthorized',
      code: 'TOKEN_REVOKED',
      message: 'Sesi telah berakhir. Silakan login kembali.'
    } as ApiError, 401)
  }

  c.set('user', payload)
  await next()
}

export const requireRole = (role: Role) => {
  return async (c: Context<{ Bindings: Env; Variables: { user: UserPayload } }>, next: Next) => {
    const user = c.get('user')
    if (user.role !== role) {
      return c.json({
        error: 'Forbidden',
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'Anda tidak memiliki akses ke resource ini.'
      } as ApiError, 403)
    }
    await next()
  }
}

// Re-export scope helpers supaya bisa di-import dari satu tempat
export {
  requireAnyRole,
  requireAdmin,
  requireCanMutate,
  isGlobalRead,
  isPrivileged,
  isReadOnly,
  canMutate,
  resolveKamarScope,
  asramaMatches,
  canAccessKamar
} from '../lib/scope'