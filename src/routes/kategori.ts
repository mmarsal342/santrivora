import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const kategori = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

kategori.use('*', authMiddleware)

const createSchema = z.object({
  nama: z.string().min(1, 'Nama kategori harus diisi').max(100),
  deskripsi: z.string().max(500).optional(),
  urutan_keparahan: z.number().int().min(0).default(0)
})

const updateSchema = z.object({
  nama: z.string().min(1).max(100).optional(),
  deskripsi: z.string().max(500).nullable().optional(),
  urutan_keparahan: z.number().int().min(0).optional(),
  is_active: z.number().int().optional()
})

function requireAdmin(c: any, next: any) {
  const user = c.get('user')
  if (user.role !== 'admin') {
    return c.json({
      error: 'Forbidden',
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Hanya admin yang dapat mengelola kategori pelanggaran.'
    } as ApiError, 403)
  }
  return next()
}

// GET /api/kategori-pelanggaran
kategori.get('/', async (c) => {
  const { is_active } = c.req.query()

  let query = 'SELECT * FROM kategori_pelanggaran'
  const params: unknown[] = []

  if (is_active !== undefined) {
    query += ' WHERE is_active = ?'
    params.push(parseInt(is_active))
  }

  query += ' ORDER BY urutan_keparahan ASC'

  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ data: result.results })
})

// GET /api/kategori-pelanggaran/:id
kategori.get('/:id', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.prepare('SELECT * FROM kategori_pelanggaran WHERE id = ?').bind(id).first()

  if (!result) {
    return c.json({
      error: 'Not Found',
      code: 'KATEGORI_NOT_FOUND',
      message: 'Kategori pelanggaran tidak ditemukan.'
    } as ApiError, 404)
  }

  return c.json({ data: result })
})

// POST /api/kategori-pelanggaran — admin only
kategori.post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')
  const id = crypto.randomUUID()

  await c.env.DB.prepare(
    `INSERT INTO kategori_pelanggaran (id, nama, deskripsi, urutan_keparahan) VALUES (?, ?, ?, ?)`
  ).bind(id, data.nama, data.deskripsi || null, data.urutan_keparahan).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'kategori.create', 'kategori_pelanggaran', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM kategori_pelanggaran WHERE id = ?').bind(id).first()
  return c.json({ message: 'Kategori pelanggaran berhasil dibuat.', data: result }, 201)
})

// PUT /api/kategori-pelanggaran/:id — admin only
kategori.put('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kategori_pelanggaran WHERE id = ?').bind(id).first()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KATEGORI_NOT_FOUND',
      message: 'Kategori pelanggaran tidak ditemukan.'
    } as ApiError, 404)
  }

  const updates: string[] = []
  const params: unknown[] = []

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      updates.push(`${key} = ?`)
      params.push(value)
    }
  }

  if (updates.length === 0) {
    return c.json({ message: 'Tidak ada perubahan.', data: existing })
  }

  updates.push("updated_at = datetime('now')")
  params.push(id)

  await c.env.DB.prepare(`UPDATE kategori_pelanggaran SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'kategori.update', 'kategori_pelanggaran', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM kategori_pelanggaran WHERE id = ?').bind(id).first()
  return c.json({ message: 'Kategori pelanggaran berhasil diperbarui.', data: result })
})

// DELETE /api/kategori-pelanggaran/:id — admin only (soft delete)
kategori.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kategori_pelanggaran WHERE id = ? AND is_active = 1').bind(id).first()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KATEGORI_NOT_FOUND',
      message: 'Kategori tidak ditemukan atau sudah tidak aktif.'
    } as ApiError, 404)
  }

  // Check if used in catatan_disiplin
  const usage = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM catatan_disiplin WHERE kategori_id = ? AND is_deleted = 0'
  ).bind(id).first<{ count: number }>()

  if (usage && usage.count > 0) {
    // Soft delete only
    await c.env.DB.prepare("UPDATE kategori_pelanggaran SET is_active = 0, updated_at = datetime('now') WHERE id = ?").bind(id).run()
    return c.json({ message: `Kategori dinonaktifkan (masih digunakan di ${usage.count} catatan).` })
  }

  await c.env.DB.prepare("UPDATE kategori_pelanggaran SET is_active = 0, updated_at = datetime('now') WHERE id = ?").bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'kategori.delete', 'kategori_pelanggaran', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Kategori pelanggaran berhasil dinonaktifkan.' })
})

export { kategori as kategoriRoutes }