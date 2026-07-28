import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth'
import { closeSantriKamarHistory } from '../lib/riwayatKamar'
import type { ApiError, Env, UserPayload } from '../types'

const kelas = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

kelas.use('*', authMiddleware)

const createSchema = z.object({
  nama: z.string().min(1, 'Nama kelas harus diisi').max(100),
  tingkatan: z.string().max(50).optional(),
  tahun_ajaran: z.string().max(20).optional()
})

const updateSchema = createSchema.partial().extend({
  is_active: z.number().int().optional()
})

const naikkanSchema = z.object({
  lulus: z.boolean(),
  target_kelas_id: z.string().uuid().optional(),
  santri_ids: z.array(z.string().uuid()).optional()
}).refine((data) => data.lulus || !!data.target_kelas_id, {
  message: 'target_kelas_id wajib diisi kalau bukan kelulusan',
  path: ['target_kelas_id']
})

// GET /api/kelas — admin: semua, ustadz: yang dipegang
kelas.get('/', async (c) => {
  const user = c.get('user')

  let results: unknown[] = []

  if (user.role === 'admin' || user.role === 'kyai') {
    const query = `
      SELECT k.*, COUNT(s.id) as jumlah_santri
      FROM kelas k
      LEFT JOIN santri s ON s.kelas_id = k.id AND s.status = 'aktif'
      GROUP BY k.id
      ORDER BY k.tingkatan ASC, k.nama ASC
    `
    const dbResult = await c.env.DB.prepare(query).all()
    results = dbResult.results || []
  } else {
    const kelasIds = user.kelas_ids
    if (kelasIds.length === 0) {
      return c.json({ data: [] })
    }
    const placeholders = kelasIds.map(() => '?').join(',')
    const query = `
      SELECT k.*, COUNT(s.id) as jumlah_santri
      FROM kelas k
      LEFT JOIN santri s ON s.kelas_id = k.id AND s.status = 'aktif'
      WHERE k.id IN (${placeholders})
      GROUP BY k.id
      ORDER BY k.tingkatan ASC, k.nama ASC
    `
    const dbResult = await c.env.DB.prepare(query).bind(...kelasIds).all()
    results = dbResult.results || []
  }

  return c.json({ data: results })
})

// GET /api/kelas/:id
kelas.get('/:id', async (c) => {
  const user = c.get('user')
  const kelasId = c.req.param('id')

  if (user.role === 'ustadz' && !user.kelas_ids.includes(kelasId)) {
    return c.json({
      error: 'Forbidden',
      code: 'KELAS_NOT_ASSIGNED',
      message: 'Anda tidak mengajar kelas ini.'
    } as ApiError, 403)
  }

  const result = await c.env.DB.prepare(`
    SELECT k.*, COUNT(s.id) as jumlah_santri
    FROM kelas k
    LEFT JOIN santri s ON s.kelas_id = k.id AND s.status = 'aktif'
    WHERE k.id = ?
    GROUP BY k.id
  `).bind(kelasId).first()

  if (!result) {
    return c.json({
      error: 'Not Found',
      code: 'KELAS_NOT_FOUND',
      message: 'Kelas tidak ditemukan.'
    } as ApiError, 404)
  }

  return c.json({ data: result })
})

// POST /api/kelas — admin only
kelas.post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')
  const id = crypto.randomUUID()

  await c.env.DB.prepare(
    `INSERT INTO kelas (id, nama, tingkatan, tahun_ajaran) VALUES (?, ?, ?, ?)`
  ).bind(id, data.nama, data.tingkatan || null, data.tahun_ajaran || null).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'kelas.create', 'kelas', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM kelas WHERE id = ?').bind(id).first()
  return c.json({ message: 'Kelas berhasil dibuat.', data: result }, 201)
})

// PUT /api/kelas/:id — admin only
kelas.put('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kelas WHERE id = ?').bind(id).first()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KELAS_NOT_FOUND',
      message: 'Kelas tidak ditemukan.'
    } as ApiError, 404)
  }

  const updates: string[] = []
  const params: unknown[] = []
  if (data.nama !== undefined) { updates.push('nama = ?'); params.push(data.nama) }
  if (data.tingkatan !== undefined) { updates.push('tingkatan = ?'); params.push(data.tingkatan) }
  if (data.tahun_ajaran !== undefined) { updates.push('tahun_ajaran = ?'); params.push(data.tahun_ajaran) }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); params.push(data.is_active) }

  if (updates.length === 0) {
    return c.json({ message: 'Tidak ada perubahan.', data: existing })
  }

  updates.push("updated_at = datetime('now')")
  params.push(id)

  await c.env.DB.prepare(
    `UPDATE kelas SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'kelas.update', 'kelas', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM kelas WHERE id = ?').bind(id).first()
  return c.json({ message: 'Kelas berhasil diperbarui.', data: result })
})

// DELETE /api/kelas/:id — admin only (soft delete)
kelas.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kelas WHERE id = ? AND is_active = 1').bind(id).first()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KELAS_NOT_FOUND',
      message: 'Kelas tidak ditemukan atau sudah tidak aktif.'
    } as ApiError, 404)
  }

  await c.env.DB.prepare(
    "UPDATE kelas SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'kelas.delete', 'kelas', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Kelas berhasil dinonaktifkan.' })
})

// POST /api/kelas/:id/naikkan — kenaikan kelas massal (admin only).
// Cuma mengubah kelas_id (atau status jadi 'lulus') — kamar_id sengaja TIDAK
// disentuh sama sekali, karena pindah kamar sudah punya alur sendiri
// (santri.ts) dan tidak selalu terjadi bersamaan dengan naik kelas.
kelas.post('/:id/naikkan', requireAdmin, zValidator('json', naikkanSchema), async (c) => {
  const sourceKelasId = c.req.param('id')
  const { lulus, target_kelas_id, santri_ids } = c.req.valid('json')
  const user = c.get('user')

  const source = await c.env.DB.prepare('SELECT id FROM kelas WHERE id = ?').bind(sourceKelasId).first()
  if (!source) {
    return c.json({
      error: 'Not Found',
      code: 'KELAS_NOT_FOUND',
      message: 'Kelas asal tidak ditemukan.'
    } as ApiError, 404)
  }

  if (!lulus) {
    if (target_kelas_id === sourceKelasId) {
      return c.json({
        error: 'Bad Request',
        code: 'TARGET_SAME_AS_SOURCE',
        message: 'Kelas tujuan tidak boleh sama dengan kelas asal.'
      } as ApiError, 400)
    }
    const target = await c.env.DB.prepare('SELECT id FROM kelas WHERE id = ? AND is_active = 1').bind(target_kelas_id).first()
    if (!target) {
      return c.json({
        error: 'Bad Request',
        code: 'TARGET_KELAS_NOT_FOUND',
        message: 'Kelas tujuan tidak ditemukan atau tidak aktif.'
      } as ApiError, 400)
    }
  }

  let santriRows: Array<{ id: string }>
  if (santri_ids && santri_ids.length > 0) {
    const ph = santri_ids.map(() => '?').join(',')
    const rows = await c.env.DB.prepare(
      `SELECT id FROM santri WHERE id IN (${ph}) AND kelas_id = ? AND status = 'aktif'`
    ).bind(...santri_ids, sourceKelasId).all<{ id: string }>()
    santriRows = rows.results || []
    if (santriRows.length !== santri_ids.length) {
      return c.json({
        error: 'Bad Request',
        code: 'SANTRI_IDS_INVALID',
        message: 'Beberapa santri_id tidak valid, bukan santri aktif, atau bukan di kelas asal ini.'
      } as ApiError, 400)
    }
  } else {
    const rows = await c.env.DB.prepare(
      `SELECT id FROM santri WHERE kelas_id = ? AND status = 'aktif'`
    ).bind(sourceKelasId).all<{ id: string }>()
    santriRows = rows.results || []
  }

  if (santriRows.length === 0) {
    return c.json({ message: 'Tidak ada santri aktif untuk diproses.', data: { count: 0, santri_ids: [] } })
  }

  const ids = santriRows.map((r) => r.id)
  const ph = ids.map(() => '?').join(',')

  if (lulus) {
    await c.env.DB.prepare(
      `UPDATE santri SET status = 'lulus', version = version + 1, updated_at = datetime('now') WHERE id IN (${ph})`
    ).bind(...ids).run()
    for (const santriId of ids) {
      await closeSantriKamarHistory(c.env, santriId)
    }
  } else {
    await c.env.DB.prepare(
      `UPDATE santri SET kelas_id = ?, version = version + 1, updated_at = datetime('now') WHERE id IN (${ph})`
    ).bind(target_kelas_id, ...ids).run()
  }

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, ?, 'kelas', ?, ?)`
  ).bind(
    crypto.randomUUID(),
    user.sub,
    lulus ? 'santri.lulus_bulk' : 'santri.naik_kelas_bulk',
    sourceKelasId,
    JSON.stringify({ target_kelas_id: lulus ? null : target_kelas_id, count: ids.length, santri_ids: ids })
  ).run()

  return c.json({
    message: lulus
      ? `${ids.length} santri berhasil diluluskan.`
      : `${ids.length} santri berhasil dinaikkan ke kelas baru.`,
    data: { count: ids.length, santri_ids: ids }
  })
})

function requireAdmin(c: any, next: any) {
  const user = c.get('user')
  if (user.role !== 'admin') {
    return c.json({
      error: 'Forbidden',
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Hanya admin yang dapat mengelola kelas.'
    } as ApiError, 403)
  }
  return next()
}

export { kelas as kelasRoutes }