import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const kamar = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

kamar.use('*', authMiddleware)

const createSchema = z.object({
  nama: z.string().min(1, 'Nama kamar harus diisi').max(100),
  jenis_kelamin: z.enum(['L', 'P']),
  kapasitas: z.number().int().min(0).optional()
})

const updateSchema = createSchema.partial().extend({
  is_active: z.number().int().optional()
})

function requireAdmin(c: any, next: any) {
  const user = c.get('user')
  if (user.role !== 'admin') {
    return c.json({
      error: 'Forbidden',
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Hanya admin yang dapat mengelola kamar.'
    } as ApiError, 403)
  }
  return next()
}

// GET /api/kamar — admin: semua, ustadz (wali kamar): yang dipegang
kamar.get('/', async (c) => {
  const user = c.get('user')

  let results: unknown[] = []

  if (user.role === 'admin') {
    const query = `
      SELECT k.*, COUNT(s.id) as jumlah_santri
      FROM kamar k
      LEFT JOIN santri s ON s.kamar_id = k.id AND s.status = 'aktif'
      GROUP BY k.id
      ORDER BY k.jenis_kelamin ASC, k.nama ASC
    `
    const dbResult = await c.env.DB.prepare(query).all()
    results = dbResult.results || []
  } else {
    const kamarIds = user.kamar_ids
    if (kamarIds.length === 0) {
      return c.json({ data: [] })
    }
    const placeholders = kamarIds.map(() => '?').join(',')
    const query = `
      SELECT k.*, COUNT(s.id) as jumlah_santri
      FROM kamar k
      LEFT JOIN santri s ON s.kamar_id = k.id AND s.status = 'aktif'
      WHERE k.id IN (${placeholders})
      GROUP BY k.id
      ORDER BY k.jenis_kelamin ASC, k.nama ASC
    `
    const dbResult = await c.env.DB.prepare(query).bind(...kamarIds).all()
    results = dbResult.results || []
  }

  return c.json({ data: results })
})

// GET /api/kamar/:id
kamar.get('/:id', async (c) => {
  const user = c.get('user')
  const kamarId = c.req.param('id')

  if (user.role === 'ustadz' && !user.kamar_ids.includes(kamarId)) {
    return c.json({
      error: 'Forbidden',
      code: 'KAMAR_NOT_ASSIGNED',
      message: 'Anda bukan wali kamar ini.'
    } as ApiError, 403)
  }

  const result = await c.env.DB.prepare(`
    SELECT k.*, COUNT(s.id) as jumlah_santri
    FROM kamar k
    LEFT JOIN santri s ON s.kamar_id = k.id AND s.status = 'aktif'
    WHERE k.id = ?
    GROUP BY k.id
  `).bind(kamarId).first()

  if (!result) {
    return c.json({
      error: 'Not Found',
      code: 'KAMAR_NOT_FOUND',
      message: 'Kamar tidak ditemukan.'
    } as ApiError, 404)
  }

  return c.json({ data: result })
})

// POST /api/kamar — admin only
kamar.post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')
  const id = crypto.randomUUID()

  await c.env.DB.prepare(
    `INSERT INTO kamar (id, nama, jenis_kelamin, kapasitas) VALUES (?, ?, ?, ?)`
  ).bind(id, data.nama, data.jenis_kelamin, data.kapasitas ?? null).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'kamar.create', 'kamar', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM kamar WHERE id = ?').bind(id).first()
  return c.json({ message: 'Kamar berhasil dibuat.', data: result }, 201)
})

// PUT /api/kamar/:id — admin only
kamar.put('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kamar WHERE id = ?').bind(id).first()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KAMAR_NOT_FOUND',
      message: 'Kamar tidak ditemukan.'
    } as ApiError, 404)
  }

  const updates: string[] = []
  const params: unknown[] = []
  if (data.nama !== undefined) { updates.push('nama = ?'); params.push(data.nama) }
  if (data.jenis_kelamin !== undefined) { updates.push('jenis_kelamin = ?'); params.push(data.jenis_kelamin) }
  if (data.kapasitas !== undefined) { updates.push('kapasitas = ?'); params.push(data.kapasitas) }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); params.push(data.is_active) }

  if (updates.length === 0) {
    return c.json({ message: 'Tidak ada perubahan.', data: existing })
  }

  updates.push("updated_at = datetime('now')")
  params.push(id)

  await c.env.DB.prepare(
    `UPDATE kamar SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'kamar.update', 'kamar', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM kamar WHERE id = ?').bind(id).first()
  return c.json({ message: 'Kamar berhasil diperbarui.', data: result })
})

// DELETE /api/kamar/:id — admin only (soft delete)
kamar.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kamar WHERE id = ? AND is_active = 1').bind(id).first()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KAMAR_NOT_FOUND',
      message: 'Kamar tidak ditemukan atau sudah tidak aktif.'
    } as ApiError, 404)
  }

  await c.env.DB.prepare(
    "UPDATE kamar SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'kamar.delete', 'kamar', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Kamar berhasil dinonaktifkan.' })
})

export { kamar as kamarRoutes }
