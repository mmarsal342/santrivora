import { sign, verify } from 'hono/jwt'
import type { JWTPayload } from 'hono/utils/jwt/types'
import bcrypt from 'bcryptjs'
import type { Role, UserPayload } from '../types'

const BCRYPT_COST = 12

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, BCRYPT_COST)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash)
}

export async function generateTokens(
  userId: string,
  email: string,
  role: string,
  kelasIds: string[],
  secrets: { access: string; refresh: string },
  kamarIds: string[] = [],
  asramaJenis: 'L' | 'P' | null = null
): Promise<{ access_token: string; refresh_token: string; refresh_jti: string }> {
  const now = Math.floor(Date.now() / 1000)
  const refreshJti = crypto.randomUUID()

  const accessPayload: UserPayload = {
    sub: userId,
    email,
    role: role as Role,
    ...(asramaJenis ? { asrama_jenis: asramaJenis } : {}),
    kelas_ids: kelasIds,
    kamar_ids: kamarIds,
    iat: now,
    exp: now + 900, // 15 minutes
    jti: crypto.randomUUID()
  }

  const refreshPayload = {
    sub: userId,
    type: 'refresh',
    iat: now,
    exp: now + 604800, // 7 days
    jti: refreshJti
  }

  const access_token = await sign(accessPayload as unknown as JWTPayload, secrets.access)
  const refresh_token = await sign(refreshPayload, secrets.refresh)

  return { access_token, refresh_token, refresh_jti: refreshJti }
}

export async function verifyAccessToken(token: string, secret: string): Promise<UserPayload | null> {
  try {
    const payload = (await verify(token, secret, 'HS256')) as unknown as UserPayload
    return payload
  } catch (err) {
    console.error('Token verify error:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function verifyRefreshToken(token: string, secret: string): Promise<{ sub: string; jti: string } | null> {
  try {
    const payload = (await verify(token, secret, 'HS256')) as { sub: string; jti: string; type: string }
    if (payload.type !== 'refresh') return null
    return payload
  } catch {
    return null
  }
}

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (password.length < 8) errors.push('Minimal 8 karakter')
  if (password.length > 128) errors.push('Maksimal 128 karakter')
  if (!/[A-Z]/.test(password)) errors.push('Butuh huruf kapital')
  if (!/[a-z]/.test(password)) errors.push('Butuh huruf kecil')
  if (!/\d/.test(password)) errors.push('Butuh angka')
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Butuh karakter spesial')

  return { valid: errors.length === 0, errors }
}