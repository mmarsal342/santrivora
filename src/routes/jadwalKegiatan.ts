import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireRole } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const jadwalKegiatan = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

jadwalKegiatan.use('*', authMiddleware)

const createSchema = z.object({
  nama: z.string().min(1, 'Nama jadwal harus diisi').max(200),
  jenis: z.string().max(50).optional(),
  urutan: z.number().int().min(0).max(999).optional(),
  kelas_id: z.string().uuid().optional(),
  kamar_id: z.string().uuid().optional()
})

const updateSchema = z.object({
  nama: z.string().min(1).max(200).optional(),
  jenis: z.string().max(50).nullable().optional(),
  urutan: z.number().int().min(0).max(999).optional(),
  kelas_id: z.string().uuid().nullable().optional(),
  kamar_id: z.string().uuid().nullable().optional(),
  is_active: z.number().int().optional()
})

// GET /api/jadwal-kegiatan — daftar template, urut sesuai jadwal harian
jadwalKegiatan.get('/', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT j.*, k.nama as kelas_nama, r.nama as kamar_nama
    FROM jadwal_kegiatan j
    LEFT JOIN kelas k ON j.kelas_id = k.id
    LEFT JOIN kamar r ON j.kamar_id = r.id
    ORDER BY j.is_active DESC, j.urutan ASC, j.nama ASC
  `).all()
  return c.json({ data: result.results || [] })
})

// POST /api/jadwal-kegiatan — admin only
jadwalKegiatan.post('/', requireRole('admin'), zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO jadwal_kegiatan (id, nama, jenis, urutan, kelas_id, kamar_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, data.nama, data.jenis || null, data.urutan ?? 0,
    data.kelas_id || null, data.kamar_id || null, user.sub
  ).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'jadwal_kegiatan.create', 'jadwal_kegiatan', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM jadwal_kegiatan WHERE id = ?').bind(id).first()
  return c.json({ message: 'Jadwal kegiatan berhasil dibuat.', data: result }, 201)
})

// PUT /api/jadwal-kegiatan/:id — admin only
jadwalKegiatan.put('/:id', requireRole('admin'), zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM jadwal_kegiatan WHERE id = ?').bind(id).first()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'JADWAL_KEGIATAN_NOT_FOUND',
      message: 'Jadwal kegiatan tidak ditemukan.'
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

  await c.env.DB.prepare(`UPDATE jadwal_kegiatan SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'jadwal_kegiatan.update', 'jadwal_kegiatan', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM jadwal_kegiatan WHERE id = ?').bind(id).first()
  return c.json({ message: 'Jadwal kegiatan berhasil diperbarui.', data: result })
})

// DELETE /api/jadwal-kegiatan/:id — soft delete, admin only
jadwalKegiatan.delete('/:id', requireRole('admin'), async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM jadwal_kegiatan WHERE id = ? AND is_active = 1').bind(id).first()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'JADWAL_KEGIATAN_NOT_FOUND',
      message: 'Jadwal kegiatan tidak ditemukan atau sudah tidak aktif.'
    } as ApiError, 404)
  }

  await c.env.DB.prepare(
    "UPDATE jadwal_kegiatan SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'jadwal_kegiatan.delete', 'jadwal_kegiatan', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Jadwal kegiatan berhasil dihapus (nonaktif).' })
})

export { jadwalKegiatan as jadwalKegiatanRoutes }
