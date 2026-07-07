import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { generateTokens, hashPassword, verifyPassword, verifyRefreshToken, validatePasswordStrength } from '../services/auth'
import { authMiddleware } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const auth = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

const registerSchema = z.object({
  email: z.string().email('Format email tidak valid').max(255),
  password: z.string()
    .min(8, 'Password minimal 8 karakter')
    .max(128, 'Password maksimal 128 karakter')
    .regex(/[A-Z]/, 'Password harus mengandung huruf kapital')
    .regex(/[a-z]/, 'Password harus mengandung huruf kecil')
    .regex(/\d/, 'Password harus mengandung angka')
    .regex(/[^A-Za-z0-9]/, 'Password harus mengandung karakter spesial'),
  nama_lengkap: z.string().min(2, 'Nama lengkap minimal 2 karakter').max(100)
})

const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(1, 'Password harus diisi')
})

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Password saat ini harus diisi'),
  new_password: z.string()
    .min(8, 'Password minimal 8 karakter')
    .max(128, 'Password maksimal 128 karakter')
    .regex(/[A-Z]/, 'Password harus mengandung huruf kapital')
    .regex(/[a-z]/, 'Password harus mengandung huruf kecil')
    .regex(/\d/, 'Password harus mengandung angka')
    .regex(/[^A-Za-z0-9]/, 'Password harus mengandung karakter spesial')
})

// POST /api/auth/register
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, nama_lengkap } = c.req.valid('json')

  // Check email uniqueness (case-insensitive)
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE LOWER(email) = LOWER(?)'
  ).bind(email).first()

  if (existing) {
    return c.json({
      error: 'Conflict',
      code: 'DUPLICATE_EMAIL',
      message: 'Email sudah terdaftar.'
    } as ApiError, 409)
  }

  // Hash password
  const passwordHash = await hashPassword(password)

  // Create user
  const userId = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, nama_lengkap, role, status)
     VALUES (?, ?, ?, ?, 'ustadz', 'pending')`
  ).bind(userId, email.toLowerCase(), passwordHash, nama_lengkap).run()

  // Audit log
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'user.register', 'users', ?, ?)`
  ).bind(
    crypto.randomUUID(),
    userId,
    userId,
    JSON.stringify({ email, nama_lengkap })
  ).run()

  return c.json({
    message: 'Akun berhasil dibuat. Menunggu persetujuan admin.',
    data: { id: userId, email, nama_lengkap }
  }, 201)
})

// POST /api/auth/login
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')

  // Find user (case-insensitive)
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE LOWER(email) = LOWER(?)'
  ).bind(email).first<{
    id: string
    email: string
    password_hash: string
    nama_lengkap: string
    role: string
    status: string
    failed_login_attempts: number
  }>()

  // Generic error to prevent email enumeration
  const genericError: ApiError = {
    error: 'Unauthorized',
    code: 'INVALID_CREDENTIALS',
    message: 'Email atau password salah.'
  }

  if (!user) {
    return c.json(genericError, 401)
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password_hash)
  if (!isValid) {
    return c.json(genericError, 401)
  }

  // Check status
  if (user.status === 'pending') {
    return c.json({
      error: 'Forbidden',
      code: 'ACCOUNT_PENDING',
      message: 'Akun Anda masih menunggu persetujuan admin.'
    } as ApiError, 403)
  }

  if (user.status === 'suspended') {
    return c.json({
      error: 'Forbidden',
      code: 'ACCOUNT_SUSPENDED',
      message: 'Akun Anda dinonaktifkan. Hubungi admin.'
    } as ApiError, 403)
  }

  // Get kelas_ids if ustadz
  let kelasIds: string[] = []
  if (user.role === 'ustadz') {
    const assignments = await c.env.DB.prepare(
      'SELECT kelas_id FROM ustadz_kelas WHERE user_id = ?'
    ).bind(user.id).all<{ kelas_id: string }>()
    kelasIds = assignments.results?.map((r) => r.kelas_id) || []
  }

  // Generate tokens
  const tokens = await generateTokens(
    user.id,
    user.email,
    user.role,
    kelasIds,
    { access: c.env.JWT_ACCESS_SECRET, refresh: c.env.JWT_REFRESH_SECRET }
  )

  // Store session
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, refresh_token_jti, ip_address, user_agent, last_activity, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'))`
  ).bind(
    crypto.randomUUID(),
    user.id,
    tokens.refresh_jti,
    c.req.header('CF-Connecting-IP') || null,
    c.req.header('User-Agent') || null
  ).run()

  // Update last_login
  await c.env.DB.prepare(
    `UPDATE users SET last_login = datetime('now'), failed_login_attempts = 0 WHERE id = ?`
  ).bind(user.id).run()

  // Audit log
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'user.login', 'users', ?)`
  ).bind(crypto.randomUUID(), user.id, user.id).run()

  return c.json({
    message: 'Login berhasil',
    data: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: {
        id: user.id,
        email: user.email,
        nama_lengkap: user.nama_lengkap,
        role: user.role,
        status: user.status,
        kelas_ids: kelasIds
      }
    }
  })
})

// POST /api/auth/refresh
auth.post('/refresh', async (c) => {
  const body = await c.req.json<{ refresh_token?: string }>().catch(() => ({}))
  const refreshToken = body.refresh_token

  if (!refreshToken) {
    return c.json({
      error: 'Bad Request',
      code: 'NO_REFRESH_TOKEN',
      message: 'Refresh token tidak ditemukan.'
    } as ApiError, 400)
  }

  const payload = await verifyRefreshToken(refreshToken, c.env.JWT_REFRESH_SECRET)
  if (!payload) {
    return c.json({
      error: 'Unauthorized',
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token tidak valid atau sudah kedaluwarsa.'
    } as ApiError, 401)
  }

  // Session must exist, be unrevoked, and not expired — catches logout,
  // admin suspend/reset-password, and reuse of an already-rotated refresh token
  const session = await c.env.DB.prepare(
    `SELECT id FROM sessions
     WHERE refresh_token_jti = ? AND user_id = ? AND is_revoked = 0 AND expires_at > datetime('now')`
  ).bind(payload.jti, payload.sub).first<{ id: string }>()

  if (!session) {
    return c.json({
      error: 'Unauthorized',
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.'
    } as ApiError, 401)
  }

  // Get user
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(payload.sub).first<{
    id: string
    email: string
    nama_lengkap: string
    role: string
    status: string
  }>()

  if (!user || user.status !== 'approved') {
    return c.json({
      error: 'Unauthorized',
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Akun tidak valid.'
    } as ApiError, 401)
  }

  // Get kelas_ids
  let kelasIds: string[] = []
  if (user.role === 'ustadz') {
    const assignments = await c.env.DB.prepare(
      'SELECT kelas_id FROM ustadz_kelas WHERE user_id = ?'
    ).bind(user.id).all<{ kelas_id: string }>()
    kelasIds = assignments.results?.map((r) => r.kelas_id) || []
  }

  // Generate new tokens
  const tokens = await generateTokens(
    user.id,
    user.email,
    user.role,
    kelasIds,
    { access: c.env.JWT_ACCESS_SECRET, refresh: c.env.JWT_REFRESH_SECRET }
  )

  // Rotate the session's jti — the old refresh token can no longer be used,
  // so a replay of it after this point is detected as an unknown jti above
  await c.env.DB.prepare(
    `UPDATE sessions SET refresh_token_jti = ?, last_activity = datetime('now') WHERE id = ?`
  ).bind(tokens.refresh_jti, session.id).run()

  return c.json({
    message: 'Token diperbarui',
    data: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    }
  })
})

// POST /api/auth/logout
auth.post('/logout', async (c) => {
  const body = await c.req.json<{ access_token?: string; refresh_token?: string }>().catch(() => ({}))
  const accessToken = body.access_token

  if (accessToken) {
    // Blacklist the access token
    try {
      const parts = accessToken.split('.')
      if (parts.length === 3) {
        const payloadB64 = parts[1]
        const payload = JSON.parse(atob(payloadB64)) as { jti: string; exp: number }
        const remainingSeconds = payload.exp - Math.floor(Date.now() / 1000)
        if (remainingSeconds > 0) {
          await c.env.KV.put(`blacklist:${payload.jti}`, 'true', {
            expirationTtl: remainingSeconds
          })
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  if (body.refresh_token) {
    // Revoke the session so the refresh token can't be used again
    const payload = await verifyRefreshToken(body.refresh_token, c.env.JWT_REFRESH_SECRET)
    if (payload) {
      await c.env.DB.prepare(
        `UPDATE sessions SET is_revoked = 1 WHERE refresh_token_jti = ? AND user_id = ?`
      ).bind(payload.jti, payload.sub).run()
    }
  }

  return c.json({ message: 'Logout berhasil' })
})

// GET /api/auth/me
auth.get('/me', authMiddleware, async (c) => {
  const userPayload = c.get('user')

  const user = await c.env.DB.prepare(
    'SELECT id, email, nama_lengkap, role, status, last_login FROM users WHERE id = ?'
  ).bind(userPayload.sub).first()

  if (!user) {
    return c.json({
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User tidak ditemukan.'
    } as ApiError, 404)
  }

  let kelasIds: string[] = []
  let assignedKelas: unknown[] = []
  if (userPayload.role === 'ustadz') {
    const assignments = await c.env.DB.prepare(
      `SELECT k.id, k.nama, k.tingkatan, k.tahun_ajaran
       FROM ustadz_kelas uk
       JOIN kelas k ON uk.kelas_id = k.id
       WHERE uk.user_id = ? AND k.is_active = 1`
    ).bind(userPayload.sub).all()
    assignedKelas = assignments.results || []
    kelasIds = (assignments.results || []).map((k: { id: string }) => k.id)
  }

  return c.json({
    data: {
      ...user,
      kelas_ids: kelasIds,
      assigned_kelas: assignedKelas
    }
  })
})

// POST /api/auth/change-password (self-service, requires current password)
auth.post('/change-password', authMiddleware, zValidator('json', changePasswordSchema), async (c) => {
  const { current_password, new_password } = c.req.valid('json')
  const userPayload = c.get('user')

  // Get current password hash
  const user = await c.env.DB.prepare(
    'SELECT password_hash FROM users WHERE id = ?'
  ).bind(userPayload.sub).first<{ password_hash: string }>()

  if (!user) {
    return c.json({
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User tidak ditemukan.'
    } as ApiError, 404)
  }

  // Verify current password
  const isValid = await verifyPassword(current_password, user.password_hash)
  if (!isValid) {
    return c.json({
      error: 'Unauthorized',
      code: 'INVALID_CREDENTIALS',
      message: 'Password saat ini salah.'
    } as ApiError, 401)
  }

  // Prevent same password
  if (current_password === new_password) {
    return c.json({
      error: 'Bad Request',
      code: 'SAME_PASSWORD',
      message: 'Password baru tidak boleh sama dengan password lama.'
    } as ApiError, 400)
  }

  // Hash new password
  const newHash = await hashPassword(new_password)

  // Update password
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(newHash, userPayload.sub).run()

  // Audit log
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'user.change_password', 'users', ?)`
  ).bind(crypto.randomUUID(), userPayload.sub, userPayload.sub).run()

  // Blacklist current access token (force re-login on other devices)
  const remainingSeconds = userPayload.exp - Math.floor(Date.now() / 1000)
  if (remainingSeconds > 0) {
    await c.env.KV.put(`blacklist:${userPayload.jti}`, 'true', {
      expirationTtl: remainingSeconds
    })
  }

  // Revoke all existing refresh-token sessions
  await c.env.DB.prepare(
    'UPDATE sessions SET is_revoked = 1 WHERE user_id = ?'
  ).bind(userPayload.sub).run()

  // Generate new tokens + a fresh session for this device
  const tokens = await generateTokens(
    userPayload.sub,
    userPayload.email,
    userPayload.role,
    userPayload.kelas_ids,
    { access: c.env.JWT_ACCESS_SECRET, refresh: c.env.JWT_REFRESH_SECRET }
  )

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, refresh_token_jti, ip_address, user_agent, last_activity, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'))`
  ).bind(
    crypto.randomUUID(),
    userPayload.sub,
    tokens.refresh_jti,
    c.req.header('CF-Connecting-IP') || null,
    c.req.header('User-Agent') || null
  ).run()

  return c.json({
    message: 'Password berhasil diubah.',
    data: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    }
  })
})

export { auth as authRoutes }