import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { hashPassword } from '../services/auth'
import { authMiddleware, requireRole } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const admin = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

admin.use('*', authMiddleware, requireRole('admin'))

const approveSchema = z.object({
  kelas_ids: z.array(z.string().uuid()).min(1, 'Minimal 1 kelas harus diassign')
})

const resetPasswordSchema = z.object({
  new_password: z.string()
    .min(8, 'Password minimal 8 karakter')
    .max(128, 'Password maksimal 128 karakter')
    .regex(/[A-Z]/, 'Password harus mengandung huruf kapital')
    .regex(/[a-z]/, 'Password harus mengandung huruf kecil')
    .regex(/\d/, 'Password harus mengandung angka')
    .regex(/[^A-Za-z0-9]/, 'Password harus mengandung karakter spesial')
})

// GET /api/admin/users — list users with optional status filter
admin.get('/users', async (c) => {
  const status = c.req.query('status')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = (page - 1) * limit

  let query = 'SELECT id, email, nama_lengkap, role, status, last_login, created_at FROM users'
  let countQuery = 'SELECT COUNT(*) as total FROM users'
  const params: string[] = []

  if (status) {
    query += ' WHERE status = ?'
    countQuery += ' WHERE status = ?'
    params.push(status)
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

  const users = await c.env.DB.prepare(query).bind(...params, limit, offset).all()
  const total = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>()

  return c.json({
    data: users.results,
    pagination: {
      page,
      limit,
      total: total?.total || 0,
      total_pages: Math.ceil((total?.total || 0) / limit)
    }
  })
})

// GET /api/admin/users/:id — detail user
admin.get('/users/:id', async (c) => {
  const userId = c.req.param('id')

  const user = await c.env.DB.prepare(
    'SELECT id, email, nama_lengkap, role, status, last_login, created_at, updated_at FROM users WHERE id = ?'
  ).bind(userId).first()

  if (!user) {
    return c.json({
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User tidak ditemukan.'
    } as ApiError, 404)
  }

  // Get assigned kelas
  const assignments = await c.env.DB.prepare(
    `SELECT k.id, k.nama, k.tingkatan, k.tahun_ajaran
     FROM ustadz_kelas uk
     JOIN kelas k ON uk.kelas_id = k.id
     WHERE uk.user_id = ?`
  ).bind(userId).all()

  return c.json({
    data: { ...user, assigned_kelas: assignments.results }
  })
})

// POST /api/admin/users/:id/approve — approve + assign kelas
admin.post('/users/:id/approve', zValidator('json', approveSchema), async (c) => {
  const userId = c.req.param('id')
  const { kelas_ids } = c.req.valid('json')
  const adminUser = c.get('user')

  const user = await c.env.DB.prepare(
    'SELECT id, status FROM users WHERE id = ?'
  ).bind(userId).first<{ id: string; status: string }>()

  if (!user) {
    return c.json({
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User tidak ditemukan.'
    } as ApiError, 404)
  }

  if (user.status === 'approved') {
    return c.json({
      error: 'Bad Request',
      code: 'ALREADY_APPROVED',
      message: 'User sudah berstatus approved.'
    } as ApiError, 400)
  }

  // Validate kelas exist
  const placeholders = kelas_ids.map(() => '?').join(',')
  const validKelas = await c.env.DB.prepare(
    `SELECT id FROM kelas WHERE id IN (${placeholders}) AND is_active = 1`
  ).bind(...kelas_ids).all()

  if (validKelas.results.length !== kelas_ids.length) {
    return c.json({
      error: 'Bad Request',
      code: 'INVALID_KELAS',
      message: 'Beberapa kelas tidak ditemukan atau tidak aktif.'
    } as ApiError, 400)
  }

  // Update user status
  await c.env.DB.prepare(
    `UPDATE users SET status = 'approved', updated_at = datetime('now') WHERE id = ?`
  ).bind(userId).run()

  // Assign kelas (delete old + insert new)
  await c.env.DB.prepare('DELETE FROM ustadz_kelas WHERE user_id = ?').bind(userId).run()

  const stmt = c.env.DB.prepare(
    'INSERT INTO ustadz_kelas (user_id, kelas_id) VALUES (?, ?)'
  )
  const batch = kelas_ids.map((kelasId) => stmt.bind(userId, kelasId))
  await c.env.DB.batch(batch)

  // Audit log
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'user.approve', 'users', ?, ?)`
  ).bind(
    crypto.randomUUID(),
    adminUser.sub,
    userId,
    JSON.stringify({ status: 'approved', kelas_ids })
  ).run()

  return c.json({
    message: 'User berhasil diaktifkan dan kelas telah diassign.',
    data: { id: userId, status: 'approved', kelas_ids }
  })
})

// POST /api/admin/users/:id/suspend
admin.post('/users/:id/suspend', async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')

  if (userId === adminUser.sub) {
    return c.json({
      error: 'Bad Request',
      code: 'CANNOT_SUSPEND_SELF',
      message: 'Tidak dapat menonaktifkan akun sendiri.'
    } as ApiError, 400)
  }

  const user = await c.env.DB.prepare(
    'SELECT id, status, role FROM users WHERE id = ?'
  ).bind(userId).first<{ id: string; status: string; role: string }>()

  if (!user) {
    return c.json({
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User tidak ditemukan.'
    } as ApiError, 404)
  }

  if (user.role === 'admin') {
    return c.json({
      error: 'Bad Request',
      code: 'CANNOT_SUSPEND_ADMIN',
      message: 'Tidak dapat menonaktifkan akun admin.'
    } as ApiError, 400)
  }

  await c.env.DB.prepare(
    `UPDATE users SET status = 'suspended', updated_at = datetime('now') WHERE id = ?`
  ).bind(userId).run()

  // Revoke all sessions
  await c.env.DB.prepare(
    'UPDATE sessions SET is_revoked = 1 WHERE user_id = ?'
  ).bind(userId).run()

  // Audit log
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'user.suspend', 'users', ?)`
  ).bind(crypto.randomUUID(), adminUser.sub, userId).run()

  return c.json({ message: 'User berhasil dinonaktifkan.' })
})

// POST /api/admin/users/:id/activate — reactivate suspended user
admin.post('/users/:id/activate', async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')

  await c.env.DB.prepare(
    `UPDATE users SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND status = 'suspended'`
  ).bind(userId).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'user.activate', 'users', ?)`
  ).bind(crypto.randomUUID(), adminUser.sub, userId).run()

  return c.json({ message: 'User berhasil diaktifkan kembali.' })
})

// POST /api/admin/users/:id/reset-password — admin resets user password
admin.post('/users/:id/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
  const userId = c.req.param('id')
  const { new_password } = c.req.valid('json')
  const adminUser = c.get('user')

  const user = await c.env.DB.prepare(
    'SELECT id, email FROM users WHERE id = ?'
  ).bind(userId).first<{ id: string; email: string }>()

  if (!user) {
    return c.json({
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User tidak ditemukan.'
    } as ApiError, 404)
  }

  const newHash = await hashPassword(new_password)

  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(newHash, userId).run()

  // Revoke all sessions (force re-login)
  await c.env.DB.prepare(
    'UPDATE sessions SET is_revoked = 1 WHERE user_id = ?'
  ).bind(userId).run()

  // Audit log
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'admin.reset_password', 'users', ?)`
  ).bind(crypto.randomUUID(), adminUser.sub, userId).run()

  return c.json({
    message: `Password untuk ${user.email} berhasil direset. User perlu login kembali.`
  })
})

// GET /api/admin/audit-log — view audit logs
admin.get('/audit-log', async (c) => {
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  const action = c.req.query('action')
  const userId = c.req.query('user_id')

  let query = `SELECT al.*, u.nama_lengkap as user_name
               FROM audit_log al
               LEFT JOIN users u ON al.user_id = u.id
               WHERE 1=1`
  let countQuery = 'SELECT COUNT(*) as total FROM audit_log WHERE 1=1'
  const params: string[] = []

  if (action) {
    query += ' AND al.action = ?'
    countQuery += ' AND action = ?'
    params.push(action)
  }
  if (userId) {
    query += ' AND al.user_id = ?'
    countQuery += ' AND user_id = ?'
    params.push(userId)
  }

  query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?'

  const logs = await c.env.DB.prepare(query).bind(...params, limit, offset).all()
  const total = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>()

  return c.json({
    data: logs.results,
    pagination: {
      page,
      limit,
      total: total?.total || 0,
      total_pages: Math.ceil((total?.total || 0) / limit)
    }
  })
})

export { admin as adminRoutes }