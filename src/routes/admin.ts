import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { hashPassword } from '../services/auth'
import { authMiddleware, requireRole, requireAnyRole } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const admin = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

admin.use('*', authMiddleware)

const approveSchema = z.object({
  kamar_ids: z.array(z.string().uuid())
})

const assignRoleSchema = z.object({
  role: z.enum(['ustadz', 'kyai', 'kepala_asrama']),
  asrama_jenis: z.enum(['L', 'P']).optional()
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
// admin: semua user; kepala_asrama: ustadz yang pegang kamar di asramanya
admin.get('/users', requireAnyRole('admin', 'kepala_asrama'), async (c) => {
  const user = c.get('user')
  const status = c.req.query('status')
  const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20') || 20, 1), 200)
  const offset = (page - 1) * limit

  let query = 'SELECT id, email, nama_lengkap, role, asrama_jenis, status, last_login, created_at FROM users'
  let countQuery = 'SELECT COUNT(*) as total FROM users'
  const params: (string | number)[] = []
  const whereParts: string[] = []

  if (status) {
    whereParts.push('status = ?')
    params.push(status)
  }

  // kepala_asrama: batasi ke ustadz yang pegang kamar di asramanya
  if (user.role === 'kepala_asrama') {
    query = `SELECT DISTINCT u.id, u.email, u.nama_lengkap, u.role, u.asrama_jenis, u.status, u.last_login, u.created_at
             FROM users u
             INNER JOIN ustadz_kamar uk ON uk.user_id = u.id
             INNER JOIN kamar k ON uk.kamar_id = k.id AND k.jenis_kelamin = ?`
    countQuery = `SELECT COUNT(DISTINCT u.id) as total
                  FROM users u
                  INNER JOIN ustadz_kamar uk ON uk.user_id = u.id
                  INNER JOIN kamar k ON uk.kamar_id = k.id AND k.jenis_kelamin = ?`
    params.unshift(user.asrama_jenis || '')
    whereParts.push("u.role = 'ustadz'")
  }

  if (whereParts.length > 0) {
    query += ' WHERE ' + whereParts.join(' AND ')
    countQuery += ' WHERE ' + whereParts.join(' AND ')
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

  const users = await c.env.DB.prepare(query).bind(...params, limit, offset).all<{ id: string }>()
  const total = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>()

  const userRows = users.results || []
  const userIds = userRows.map((u) => u.id)

  const kelasMap = new Map<string, Array<{ id: string; nama: string; tingkatan: string | null }>>()
  const kamarMap = new Map<string, Array<{ id: string; nama: string; jenis_kelamin: string }>>()

  if (userIds.length > 0) {
    const ph = userIds.map(() => '?').join(',')
    const [kelasRows, kamarRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT uk.user_id, k.id, k.nama, k.tingkatan
         FROM ustadz_kelas uk JOIN kelas k ON uk.kelas_id = k.id
         WHERE uk.user_id IN (${ph})`
      ).bind(...userIds).all<{ user_id: string; id: string; nama: string; tingkatan: string | null }>(),
      c.env.DB.prepare(
        `SELECT uk.user_id, k.id, k.nama, k.jenis_kelamin
         FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id
         WHERE uk.user_id IN (${ph})`
      ).bind(...userIds).all<{ user_id: string; id: string; nama: string; jenis_kelamin: string }>()
    ])
    for (const row of kelasRows.results || []) {
      if (!kelasMap.has(row.user_id)) kelasMap.set(row.user_id, [])
      kelasMap.get(row.user_id)!.push({ id: row.id, nama: row.nama, tingkatan: row.tingkatan })
    }
    for (const row of kamarRows.results || []) {
      if (!kamarMap.has(row.user_id)) kamarMap.set(row.user_id, [])
      kamarMap.get(row.user_id)!.push({ id: row.id, nama: row.nama, jenis_kelamin: row.jenis_kelamin })
    }
  }

  const data = userRows.map((u) => ({
    ...u,
    assigned_kelas: kelasMap.get(u.id) || [],
    assigned_kamar: kamarMap.get(u.id) || []
  }))

  return c.json({
    data,
    pagination: {
      page,
      limit,
      total: total?.total || 0,
      total_pages: Math.ceil((total?.total || 0) / limit)
    }
  })
})

// GET /api/admin/users/:id — detail user
admin.get('/users/:id', requireAnyRole('admin', 'kepala_asrama'), async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')

  const user = await c.env.DB.prepare(
    'SELECT id, email, nama_lengkap, role, status, last_login, created_at, updated_at FROM users WHERE id = ?'
  ).bind(userId).first<{ role: string }>()

  if (!user) {
    return c.json({
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User tidak ditemukan.'
    } as ApiError, 404)
  }

  // kepala_asrama: hanya bisa lihat ustadz yang pegang kamar di asramanya
  if (adminUser.role === 'kepala_asrama') {
    if (user.role !== 'ustadz') {
      return c.json({
        error: 'Forbidden',
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'Anda hanya dapat melihat akun ustadz.'
      } as ApiError, 403)
    }
    const inAsrama = await c.env.DB.prepare(
      `SELECT 1 FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id
       WHERE uk.user_id = ? AND k.jenis_kelamin = ? LIMIT 1`
    ).bind(userId, adminUser.asrama_jenis || '').first()
    if (!inAsrama) {
      return c.json({
        error: 'Forbidden',
        code: 'USER_NOT_IN_ASRAMA',
        message: 'Ustadz ini tidak berada di asrama Anda.'
      } as ApiError, 403)
    }
  }

  // Get assigned kelas + kamar
  const [kelasAssignments, kamarAssignments] = await Promise.all([
    c.env.DB.prepare(
      `SELECT k.id, k.nama, k.tingkatan, k.tahun_ajaran
       FROM ustadz_kelas uk
       JOIN kelas k ON uk.kelas_id = k.id
       WHERE uk.user_id = ?`
    ).bind(userId).all(),
    c.env.DB.prepare(
      `SELECT k.id, k.nama, k.jenis_kelamin, k.kapasitas
       FROM ustadz_kamar uk
       JOIN kamar k ON uk.kamar_id = k.id
       WHERE uk.user_id = ?`
    ).bind(userId).all()
  ])

  return c.json({
    data: { ...user, assigned_kelas: kelasAssignments.results, assigned_kamar: kamarAssignments.results }
  })
})

// POST /api/admin/users/:id/approve — approve (idempotent) + assign wali kamar.
// Dipanggil juga buat edit kamar user yang sudah approved, jadi gak ada endpoint terpisah.
admin.post('/users/:id/approve', requireAnyRole('admin', 'kepala_asrama'), zValidator('json', approveSchema), async (c) => {
  const userId = c.req.param('id')
  const { kamar_ids } = c.req.valid('json')
  const adminUser = c.get('user')

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

  // kepala_asrama hanya bisa approve ustadz (bukan admin/kyai/kepala_asrama lain)
  if (adminUser.role === 'kepala_asrama' && user.role !== 'ustadz') {
    return c.json({
      error: 'Forbidden',
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Anda hanya dapat mengelola akun ustadz.'
    } as ApiError, 403)
  }

  // kepala_asrama: cek ustadz yang sudah punya kamar harus dari asramanya juga (anti "curi" ustadz)
  if (adminUser.role === 'kepala_asrama' && user.status === 'approved') {
    const existingKamar = await c.env.DB.prepare(
      `SELECT k.jenis_kelamin FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id
       WHERE uk.user_id = ? LIMIT 1`
    ).bind(userId).first<{ jenis_kelamin: string }>()
    if (existingKamar && existingKamar.jenis_kelamin !== adminUser.asrama_jenis) {
      return c.json({
        error: 'Forbidden',
        code: 'USER_NOT_IN_ASRAMA',
        message: 'Ustadz ini berada di asrama lain.'
      } as ApiError, 403)
    }
  }

  const isFirstApproval = user.status === 'pending'

  if (isFirstApproval && kamar_ids.length === 0) {
    return c.json({
      error: 'Bad Request',
      code: 'KAMAR_REQUIRED',
      message: 'Minimal 1 kamar harus diassign saat approve.'
    } as ApiError, 400)
  }

  // Validate kamar exist
  if (kamar_ids.length > 0) {
    const placeholders = kamar_ids.map(() => '?').join(',')
    const validKamar = await c.env.DB.prepare(
      `SELECT id, jenis_kelamin FROM kamar WHERE id IN (${placeholders}) AND is_active = 1`
    ).bind(...kamar_ids).all<{ jenis_kelamin: string }>()

    if (validKamar.results.length !== kamar_ids.length) {
      return c.json({
        error: 'Bad Request',
        code: 'INVALID_KAMAR',
        message: 'Beberapa kamar tidak ditemukan atau tidak aktif.'
      } as ApiError, 400)
    }

    // kepala_asrama: semua kamar harus di asramanya
    if (adminUser.role === 'kepala_asrama') {
      const allInAsrama = validKamar.results.every((k) => k.jenis_kelamin === adminUser.asrama_jenis)
      if (!allInAsrama) {
        return c.json({
          error: 'Forbidden',
          code: 'KAMAR_NOT_IN_ASRAMA',
          message: 'Anda hanya dapat mengassign kamar di asrama Anda.'
        } as ApiError, 403)
      }
    }
  }

  // Update user status (no-op kalau sudah approved), reset failed login attempts
  await c.env.DB.prepare(
    `UPDATE users SET status = 'approved', failed_login_attempts = 0, updated_at = datetime('now') WHERE id = ?`
  ).bind(userId).run()

  // Assign kamar (delete old + insert new)
  await c.env.DB.prepare('DELETE FROM ustadz_kamar WHERE user_id = ?').bind(userId).run()

  if (kamar_ids.length > 0) {
    const stmt = c.env.DB.prepare(
      'INSERT INTO ustadz_kamar (user_id, kamar_id) VALUES (?, ?)'
    )
    const batch = kamar_ids.map((kamarId) => stmt.bind(userId, kamarId))
    await c.env.DB.batch(batch)
  }

  // Revoke sessions so stale kamar_ids in token can't be refreshed
  await c.env.DB.prepare('UPDATE sessions SET is_revoked = 1 WHERE user_id = ?').bind(userId).run()

  // Audit log — beda action buat approval pertama vs sekadar edit kamar belakangan
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, ?, 'users', ?, ?)`
  ).bind(
    crypto.randomUUID(),
    adminUser.sub,
    isFirstApproval ? 'user.approve' : 'user.update_kamar',
    userId,
    JSON.stringify({ status: 'approved', kamar_ids })
  ).run()

  return c.json({
    message: 'User berhasil diaktifkan dan wali kamar telah diassign.',
    data: { id: userId, status: 'approved', kamar_ids }
  })
})

// POST /api/admin/users/:id/assign-role — admin only
// Set peran kyai / kepala_asrama. Transfer kepala_asrama otomatis: kalau asrama
// itu sudah ada kepala_asrama lain, yang lama turun jadi ustadz.
admin.post('/users/:id/assign-role', requireRole('admin'), zValidator('json', assignRoleSchema), async (c) => {
  const userId = c.req.param('id')
  const { role, asrama_jenis } = c.req.valid('json')
  const adminUser = c.get('user')

  const target = await c.env.DB.prepare(
    'SELECT id, role, asrama_jenis FROM users WHERE id = ?'
  ).bind(userId).first<{ id: string; role: string; asrama_jenis: string | null }>()

  if (!target) {
    return c.json({
      error: 'Not Found',
      code: 'USER_NOT_FOUND',
      message: 'User tidak ditemukan.'
    } as ApiError, 404)
  }

  if (target.role === 'admin') {
    return c.json({
      error: 'Bad Request',
      code: 'CANNOT_CHANGE_ADMIN',
      message: 'Role admin tidak dapat diubah.'
    } as ApiError, 400)
  }

  // Validasi: kepala_asrama wajib punya asrama_jenis
  if (role === 'kepala_asrama' && !asrama_jenis) {
    return c.json({
      error: 'Bad Request',
      code: 'ASRAMA_REQUIRED',
      message: 'Kepala asrama wajib menentukan asrama (L/P).'
    } as ApiError, 400)
  }

  // Transfer: kalau ada kepala_asrama lain di asrama yang sama, turunkan ke ustadz
  if (role === 'kepala_asrama') {
    const existing = await c.env.DB.prepare(
      `SELECT id FROM users WHERE role = 'kepala_asrama' AND asrama_jenis = ? AND id != ?`
    ).bind(asrama_jenis, userId).first<{ id: string }>()

    if (existing) {
      await c.env.DB.prepare(
        `UPDATE users SET role = 'ustadz', asrama_jenis = NULL, updated_at = datetime('now') WHERE id = ?`
      ).bind(existing.id).run()
      await c.env.DB.prepare(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
         VALUES (?, ?, 'user.demote_from_kepala', 'users', ?, ?)`
      ).bind(crypto.randomUUID(), adminUser.sub, existing.id, JSON.stringify({ reason: 'transfer', to: userId })).run()
    }
  }

  const newAsrama = role === 'kepala_asrama' ? asrama_jenis! : null
  await c.env.DB.prepare(
    `UPDATE users SET role = ?, asrama_jenis = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(role, newAsrama, userId).run()

  // Revoke sessions supaya token baru (dengan role/asrama baru) wajib di-refresh
  await c.env.DB.prepare('UPDATE sessions SET is_revoked = 1 WHERE user_id = ?').bind(userId).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'user.assign_role', 'users', ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), adminUser.sub, userId,
    JSON.stringify({ role: target.role, asrama_jenis: target.asrama_jenis }),
    JSON.stringify({ role, asrama_jenis: newAsrama })
  ).run()

  return c.json({
    message: 'Peran berhasil diperbarui.',
    data: { id: userId, role, asrama_jenis: newAsrama }
  })
})

// POST /api/admin/users/:id/suspend
admin.post('/users/:id/suspend', requireRole('admin'), async (c) => {
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
admin.post('/users/:id/activate', requireRole('admin'), async (c) => {
  const userId = c.req.param('id')
  const adminUser = c.get('user')

  await c.env.DB.prepare(
    `UPDATE users SET status = 'approved', failed_login_attempts = 0, updated_at = datetime('now') WHERE id = ? AND status = 'suspended'`
  ).bind(userId).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'user.activate', 'users', ?)`
  ).bind(crypto.randomUUID(), adminUser.sub, userId).run()

  return c.json({ message: 'User berhasil diaktifkan kembali.' })
})

// POST /api/admin/users/:id/reset-password — admin resets user password
admin.post('/users/:id/reset-password', requireRole('admin'), zValidator('json', resetPasswordSchema), async (c) => {
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
admin.get('/audit-log', requireRole('admin'), async (c) => {
  const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200)
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