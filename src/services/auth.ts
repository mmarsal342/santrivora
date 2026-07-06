import { sign, verify } from 'hono/jwt'
import bcrypt from 'bcryptjs'
import type { UserPayload, ApiError } from '../types'

const BCRYPT_COST = 12

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, BCRYPT_COST)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash)
}

export async function generateTokens(userId: string, email: string, role: string, kelasIds: string[], secrets: { access: string; refresh: string }): Promise<{ access_token: string; refresh_token: string }> {
  const accessPayload: UserPayload = {
    sub: userId,
    email,
    role: role as 'admin' | 'ustadz',
    kelas_ids: kelasIds,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900, // 15 minutes
    jti: crypto.randomUUID()
  }

  const refreshPayload = {
    sub: userId,
    type: 'refresh',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 604800, // 7 days
    jti: crypto.randomUUID()
  }

  const access_token = await sign(accessPayload, secrets.access)
  const refresh_token = await sign(refreshPayload, secrets.refresh)

  return { access_token, refresh_token }
}

export async function verifyToken(token: string, secret: string): Promise<UserPayload | null> {
  try {
    const payload = await verify(token, secret) as UserPayload

    // Check if token is blacklisted
    // TODO: Implement token blacklist check

    return payload
  } catch (err) {
    console.error('Token verification failed:', err)
    return null
  }
}

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('Minimal 8 karakter')
  }
  if (password.length > 128) {
    errors.push('Maksimal 128 karakter')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Butuh huruf kapital')
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Butuh huruf kecil')
  }
  if (!/\d/.test(password)) {
    errors.push('Butuh angka')
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Butuh karakter spesial')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}