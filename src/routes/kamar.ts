import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireCanMutate } from '../middleware/auth'
import { resolveKamarScope } from '../lib/scope'
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

// GET /api/kamar — admin/kyai: semua; kepala_asrama: asramanya; ustadz: yang dipegang
kamar.get('/', async (c) => {
  const user = c.get('user')
  const scopedKamarIds = await resolveKamarScope(c.env, user)

  if (scopedKamarIds === null) {
    const dbResult = await c.env.DB.prepare(`
      SELECT k.*, COUNT(s.id) as jumlah_santri
      FROM kamar k
      LEFT JOIN santri s ON s.kamar_id = k.id AND s.status = 'aktif'
      GROUP BY k.id
      ORDER BY k.jenis_kelamin ASC, k.nama ASC
    `).all()
    return c.json({ data: dbResult.results || [] })
  }

  if (scopedKamarIds.length === 0) return c.json({ data: [] })

  const placeholders = scopedKamarIds.map(() => '?').join(',')
  const dbResult = await c.env.DB.prepare(`
    SELECT k.*, COUNT(s.id) as jumlah_santri
    FROM kamar k
    LEFT JOIN santri s ON s.kamar_id = k.id AND s.status = 'aktif'
    WHERE k.id IN (${placeholders})
    GROUP BY k.id
    ORDER BY k.jenis_kelamin ASC, k.nama ASC
  `).bind(...scopedKamarIds).all()
  return c.json({ data: dbResult.results || [] })
})

// GET /api/kamar/:id
kamar.get('/:id', async (c) => {
  const user = c.get('user')
  const kamarId = c.req.param('id')

  const result = await c.env.DB.prepare(`
    SELECT k.*, COUNT(s.id) as jumlah_santri
    FROM kamar k
    LEFT JOIN santri s ON s.kamar_id = k.id AND s.status = 'aktif'
    WHERE k.id = ?
    GROUP BY k.id
  `).bind(kamarId).first<{ jenis_kelamin: string }>()

  if (!result) {
    return c.json({
      error: 'Not Found',
      code: 'KAMAR_NOT_FOUND',
      message: 'Kamar tidak ditemukan.'
    } as ApiError, 404)
  }

  // Scope check
  if (user.role === 'ustadz' && !user.kamar_ids.includes(kamarId)) {
    return c.json({
      error: 'Forbidden',
      code: 'KAMAR_NOT_ASSIGNED',
      message: 'Anda tidak memiliki akses ke kamar ini.'
    } as ApiError, 403)
  }
  if (user.role === 'kepala_asrama' && result.jenis_kelamin !== user.asrama_jenis) {
    return c.json({
      error: 'Forbidden',
      code: 'KAMAR_NOT_IN_ASRAMA',
      message: 'Kamar ini di luar lingkup asrama Anda.'
    } as ApiError, 403)
  }

  return c.json({ data: result })
})

// POST /api/kamar — admin atau kepala_asrama (buat kamar di asramanya)
kamar.post('/', requireCanMutate(), zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  // kepala_asrama cuma boleh buat kamar di asramanya
  if (user.role === 'kepala_asrama' && data.jenis_kelamin !== user.asrama_jenis) {
    return c.json({
      error: 'Forbidden',
      code: 'KAMAR_NOT_IN_ASRAMA',
      message: 'Anda hanya dapat membuat kamar di asrama Anda.'
    } as ApiError, 403)
  }

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

// PUT /api/kamar/:id — admin atau kepala_asrama (asramanya)
kamar.put('/:id', requireCanMutate(), zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kamar WHERE id = ?').bind(id).first<{ jenis_kelamin: string }>()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KAMAR_NOT_FOUND',
      message: 'Kamar tidak ditemukan.'
    } as ApiError, 404)
  }

  // kepala_asrama hanya kelola kamar asramanya; tidak boleh pindahkan kamar ke asrama lain
  if (user.role === 'kepala_asrama') {
    if (existing.jenis_kelamin !== user.asrama_jenis || (data.jenis_kelamin && data.jenis_kelamin !== user.asrama_jenis)) {
      return c.json({
        error: 'Forbidden',
        code: 'KAMAR_NOT_IN_ASRAMA',
        message: 'Kamar ini di luar lingkup asrama Anda.'
      } as ApiError, 403)
    }
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

// DELETE /api/kamar/:id — soft delete, admin atau kepala_asrama (asramanya)
kamar.delete('/:id', requireCanMutate(), async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kamar WHERE id = ? AND is_active = 1').bind(id).first<{ jenis_kelamin: string }>()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KAMAR_NOT_FOUND',
      message: 'Kamar tidak ditemukan atau sudah tidak aktif.'
    } as ApiError, 404)
  }

  if (user.role === 'kepala_asrama' && existing.jenis_kelamin !== user.asrama_jenis) {
    return c.json({
      error: 'Forbidden',
      code: 'KAMAR_NOT_IN_ASRAMA',
      message: 'Kamar ini di luar lingkup asrama Anda.'
    } as ApiError, 403)
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
