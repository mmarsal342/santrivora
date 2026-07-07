import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const catatan = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

catatan.use('*', authMiddleware)

const createSchema = z.object({
  santri_id: z.string().uuid(),
  tipe: z.enum(['pelanggaran', 'prestasi']),
  kategori_id: z.string().uuid().optional(),
  judul: z.string().min(1, 'Judul harus diisi').max(200),
  deskripsi: z.string().max(2000).optional(),
  tanggal_kejadian: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tindak_lanjut: z.string().max(1000).optional(),
  // Bebas diisi ustadz sendiri (bukan dropdown tetap) — cuma relevan kalau tipe = 'prestasi'
  jenis_prestasi: z.string().max(100).optional()
})

const updateSchema = z.object({
  kategori_id: z.string().uuid().nullable().optional(),
  judul: z.string().min(1).max(200).optional(),
  deskripsi: z.string().max(2000).nullable().optional(),
  tanggal_kejadian: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tindak_lanjut: z.string().max(1000).nullable().optional(),
  jenis_prestasi: z.string().max(100).nullable().optional()
})

// GET /api/catatan — scoped by role
catatan.get('/', async (c) => {
  const user = c.get('user')
  const { santri_id, tipe, kelas_id, cursor, limit } = c.req.query()

  const conditions: string[] = ['cd.is_deleted = 0']
  const params: unknown[] = []

  if (user.role === 'ustadz') {
    if (user.kelas_ids.length === 0) {
      return c.json({ data: [], pagination: { cursor: null, hasMore: false } })
    }
    const ph = user.kelas_ids.map(() => '?').join(',')
    conditions.push(`s.kelas_id IN (${ph})`)
    params.push(...user.kelas_ids)
  }

  if (santri_id) {
    conditions.push('cd.santri_id = ?')
    params.push(santri_id)
  }
  if (tipe) {
    conditions.push('cd.tipe = ?')
    params.push(tipe)
  }
  if (kelas_id) {
    if (user.role === 'ustadz' && !user.kelas_ids.includes(kelas_id)) {
      return c.json({
        error: 'Forbidden',
        code: 'KELAS_NOT_ASSIGNED',
        message: 'Anda tidak mengajar kelas ini.'
      } as ApiError, 403)
    }
    conditions.push('s.kelas_id = ?')
    params.push(kelas_id)
  }
  if (cursor) {
    conditions.push('cd.id > ?')
    params.push(cursor)
  }

  const pageLimit = Math.min(parseInt(limit || '20'), 100)
  const where = `WHERE ${conditions.join(' AND ')}`

  const query = `
    SELECT cd.*, s.nama_lengkap as santri_nama, s.kelas_id,
           kp.nama as kategori_nama, kp.urutan_keparahan,
           u.nama_lengkap as dicatat_oleh_nama
    FROM catatan_disiplin cd
    INNER JOIN santri s ON cd.santri_id = s.id
    LEFT JOIN kategori_pelanggaran kp ON cd.kategori_id = kp.id
    LEFT JOIN users u ON cd.dicatat_oleh = u.id
    ${where}
    ORDER BY cd.tanggal_kejadian DESC, cd.id ASC
    LIMIT ?
  `
  params.push(pageLimit + 1)

  const dbResult = await c.env.DB.prepare(query).bind(...params).all<{ id: string }>()
  const results = dbResult.results || []
  const hasMore = results.length > pageLimit
  const data = hasMore ? results.slice(0, pageLimit) : results
  const nextCursor = hasMore ? data[data.length - 1]?.id : null

  return c.json({
    data,
    pagination: { cursor: nextCursor, hasMore }
  })
})

// GET /api/catatan/:id
catatan.get('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const result = await c.env.DB.prepare(`
    SELECT cd.*, s.nama_lengkap as santri_nama, s.kelas_id,
           kp.nama as kategori_nama, kp.urutan_keparahan,
           u.nama_lengkap as dicatat_oleh_nama
    FROM catatan_disiplin cd
    INNER JOIN santri s ON cd.santri_id = s.id
    LEFT JOIN kategori_pelanggaran kp ON cd.kategori_id = kp.id
    LEFT JOIN users u ON cd.dicatat_oleh = u.id
    WHERE cd.id = ? AND cd.is_deleted = 0
  `).bind(id).first<{ kelas_id: string | null }>()

  if (!result) {
    return c.json({
      error: 'Not Found',
      code: 'CATATAN_NOT_FOUND',
      message: 'Catatan disiplin tidak ditemukan.'
    } as ApiError, 404)
  }

  if (user.role === 'ustadz' && result.kelas_id && !user.kelas_ids.includes(result.kelas_id)) {
    return c.json({
      error: 'Forbidden',
      code: 'KELAS_NOT_ASSIGNED',
      message: 'Anda tidak memiliki akses ke catatan ini.'
    } as ApiError, 403)
  }

  return c.json({ data: result })
})

// POST /api/catatan
catatan.post('/', zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  // Validate santri exists
  const santri = await c.env.DB.prepare(
    "SELECT id, kelas_id, status FROM santri WHERE id = ?"
  ).bind(data.santri_id).first<{ kelas_id: string | null; status: string }>()

  if (!santri) {
    return c.json({
      error: 'Not Found',
      code: 'SANTRI_NOT_FOUND',
      message: 'Santri tidak ditemukan.'
    } as ApiError, 404)
  }

  if (santri.status !== 'aktif') {
    return c.json({
      error: 'Bad Request',
      code: 'SANTRI_NOT_ACTIVE',
      message: 'Santri tidak dalam status aktif.'
    } as ApiError, 400)
  }

  // Scope check
  if (user.role === 'ustadz' && santri.kelas_id && !user.kelas_ids.includes(santri.kelas_id)) {
    return c.json({
      error: 'Forbidden',
      code: 'SANTRI_NOT_IN_ASSIGNED_KELAS',
      message: 'Anda tidak dapat mencatat untuk santri di luar kelas Anda.'
    } as ApiError, 403)
  }

  // Validate kategori if pelanggaran
  if (data.tipe === 'pelanggaran' && data.kategori_id) {
    const kategori = await c.env.DB.prepare(
      'SELECT id FROM kategori_pelanggaran WHERE id = ? AND is_active = 1'
    ).bind(data.kategori_id).first()
    if (!kategori) {
      return c.json({
        error: 'Bad Request',
        code: 'KATEGORI_NOT_FOUND',
        message: 'Kategori pelanggaran tidak ditemukan.'
      } as ApiError, 400)
    }
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO catatan_disiplin (id, santri_id, tipe, kategori_id, judul, deskripsi, tanggal_kejadian, dicatat_oleh, tindak_lanjut, jenis_prestasi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, data.santri_id, data.tipe, data.kategori_id || null,
    data.judul, data.deskripsi || null, data.tanggal_kejadian,
    user.sub, data.tindak_lanjut || null, data.jenis_prestasi || null
  ).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'catatan.create', 'catatan_disiplin', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare(`
    SELECT cd.*, kp.nama as kategori_nama
    FROM catatan_disiplin cd
    LEFT JOIN kategori_pelanggaran kp ON cd.kategori_id = kp.id
    WHERE cd.id = ?
  `).bind(id).first()

  return c.json({ message: 'Catatan disiplin berhasil ditambahkan.', data: result }, 201)
})

// PUT /api/catatan/:id
catatan.put('/:id', zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(`
    SELECT cd.*, s.kelas_id
    FROM catatan_disiplin cd
    INNER JOIN santri s ON cd.santri_id = s.id
    WHERE cd.id = ? AND cd.is_deleted = 0
  `).bind(id).first<{ kelas_id: string | null }>()

  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'CATATAN_NOT_FOUND',
      message: 'Catatan disiplin tidak ditemukan.'
    } as ApiError, 404)
  }

  // Scope check
  if (user.role === 'ustadz' && existing.kelas_id && !user.kelas_ids.includes(existing.kelas_id)) {
    return c.json({
      error: 'Forbidden',
      code: 'KELAS_NOT_ASSIGNED',
      message: 'Anda tidak memiliki akses untuk mengubah catatan ini.'
    } as ApiError, 403)
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

  updates.push("version = version + 1")
  updates.push("updated_at = datetime('now')")
  params.push(id)

  await c.env.DB.prepare(`UPDATE catatan_disiplin SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'catatan.update', 'catatan_disiplin', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM catatan_disiplin WHERE id = ?').bind(id).first()
  return c.json({ message: 'Catatan disiplin berhasil diperbarui.', data: result })
})

// DELETE /api/catatan/:id — soft delete
catatan.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(`
    SELECT cd.*, s.kelas_id
    FROM catatan_disiplin cd
    INNER JOIN santri s ON cd.santri_id = s.id
    WHERE cd.id = ? AND cd.is_deleted = 0
  `).bind(id).first<{ kelas_id: string | null }>()

  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'CATATAN_NOT_FOUND',
      message: 'Catatan disiplin tidak ditemukan.'
    } as ApiError, 404)
  }

  // Scope check
  if (user.role === 'ustadz' && existing.kelas_id && !user.kelas_ids.includes(existing.kelas_id)) {
    return c.json({
      error: 'Forbidden',
      code: 'KELAS_NOT_ASSIGNED',
      message: 'Anda tidak memiliki akses untuk menghapus catatan ini.'
    } as ApiError, 403)
  }

  await c.env.DB.prepare(
    "UPDATE catatan_disiplin SET is_deleted = 1, version = version + 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'catatan.delete', 'catatan_disiplin', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Catatan disiplin berhasil dihapus.' })
})

export { catatan as catatanRoutes }