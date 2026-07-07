import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const santri = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

santri.use('*', authMiddleware)

const createSchema = z.object({
  nama_lengkap: z.string().min(2, 'Nama lengkap minimal 2 karakter').max(200),
  jenis_kelamin: z.enum(['L', 'P']),
  kelas_id: z.string().uuid().optional(),
  kamar_id: z.string().uuid().optional(),
  angkatan: z.string().max(10).optional(),
  tanggal_masuk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  foto_url: z.string().url().optional(),
  // Profil opsional — nggak wajib diisi semua
  tanggal_lahir: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  love_language: z.string().max(200).optional()
})

const updateSchema = z.object({
  nama_lengkap: z.string().min(2).max(200).optional(),
  jenis_kelamin: z.enum(['L', 'P']).optional(),
  kelas_id: z.string().uuid().nullable().optional(),
  kamar_id: z.string().uuid().nullable().optional(),
  angkatan: z.string().max(10).nullable().optional(),
  tanggal_masuk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['aktif', 'lulus', 'keluar']).optional(),
  foto_url: z.string().url().nullable().optional(),
  tanggal_lahir: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  love_language: z.string().max(200).nullable().optional()
})

// GET /api/santri — scoped by role (wali kelas via kelas_ids, wali kamar via kamar_ids)
santri.get('/', async (c) => {
  const user = c.get('user')
  const { kelas_id, kamar_id, jenis_kelamin, angkatan, status, cursor, limit } = c.req.query()

  const params: unknown[] = []
  const conditions: string[] = []

  if (user.role === 'ustadz') {
    const scopeParts: string[] = []
    if (user.kelas_ids.length > 0) {
      scopeParts.push(`s.kelas_id IN (${user.kelas_ids.map(() => '?').join(',')})`)
    }
    if (user.kamar_ids.length > 0) {
      scopeParts.push(`s.kamar_id IN (${user.kamar_ids.map(() => '?').join(',')})`)
    }
    if (scopeParts.length === 0) {
      return c.json({ data: [], pagination: { cursor: null, hasMore: false } })
    }
    conditions.push(`(${scopeParts.join(' OR ')})`)
    params.push(...user.kelas_ids, ...user.kamar_ids)
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
  if (kamar_id) {
    if (user.role === 'ustadz' && !user.kamar_ids.includes(kamar_id)) {
      return c.json({
        error: 'Forbidden',
        code: 'KAMAR_NOT_ASSIGNED',
        message: 'Anda bukan wali kamar ini.'
      } as ApiError, 403)
    }
    conditions.push('s.kamar_id = ?')
    params.push(kamar_id)
  }
  if (jenis_kelamin) {
    conditions.push('s.jenis_kelamin = ?')
    params.push(jenis_kelamin)
  }
  if (angkatan) {
    conditions.push('s.angkatan = ?')
    params.push(angkatan)
  }
  if (status) {
    conditions.push('s.status = ?')
    params.push(status)
  }
  if (cursor) {
    conditions.push('s.id > ?')
    params.push(cursor)
  }

  const pageLimit = Math.min(parseInt(limit || '20'), 100)

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const query = `
    SELECT s.*, k.nama as kelas_nama, k.tingkatan, km.nama as kamar_nama, km.jenis_kelamin as kamar_jenis_kelamin
    FROM santri s
    LEFT JOIN kelas k ON s.kelas_id = k.id
    LEFT JOIN kamar km ON s.kamar_id = km.id
    ${where}
    ORDER BY s.id ASC
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

// GET /api/santri/:id
santri.get('/:id', async (c) => {
  const user = c.get('user')
  const santriId = c.req.param('id')

  const santriData = await c.env.DB.prepare(`
    SELECT s.*, k.nama as kelas_nama, k.tingkatan, km.nama as kamar_nama, km.jenis_kelamin as kamar_jenis_kelamin
    FROM santri s
    LEFT JOIN kelas k ON s.kelas_id = k.id
    LEFT JOIN kamar km ON s.kamar_id = km.id
    WHERE s.id = ?
  `).bind(santriId).first<{ kelas_id: string | null; kamar_id: string | null }>()

  if (!santriData) {
    return c.json({
      error: 'Not Found',
      code: 'SANTRI_NOT_FOUND',
      message: 'Santri tidak ditemukan.'
    } as ApiError, 404)
  }

  // Scope check for ustadz — accessible via kelas assignment OR kamar assignment.
  // A santri with neither assigned is unrestricted (matches the pre-kamar behavior).
  if (user.role === 'ustadz') {
    const viaKelas = !!santriData.kelas_id && user.kelas_ids.includes(santriData.kelas_id)
    const viaKamar = !!santriData.kamar_id && user.kamar_ids.includes(santriData.kamar_id)
    const santriHasAnyAssignment = !!santriData.kelas_id || !!santriData.kamar_id

    if (santriHasAnyAssignment && !viaKelas && !viaKamar) {
      return c.json({
        error: 'Forbidden',
        code: 'SANTRI_NOT_ACCESSIBLE',
        message: 'Anda tidak memiliki akses ke data santri ini.'
      } as ApiError, 403)
    }
  }

  // Get discipline records
  const catatanResult = await c.env.DB.prepare(`
    SELECT cd.*, kp.nama as kategori_nama, u.nama_lengkap as dicatat_oleh_nama
    FROM catatan_disiplin cd
    LEFT JOIN kategori_pelanggaran kp ON cd.kategori_id = kp.id
    LEFT JOIN users u ON cd.dicatat_oleh = u.id
    WHERE cd.santri_id = ? AND cd.is_deleted = 0
    ORDER BY cd.tanggal_kejadian DESC
    LIMIT 100
  `).bind(santriId).all()

  return c.json({
    data: { ...santriData, catatan_disiplin: catatanResult.results || [] }
  })
})

// POST /api/santri
santri.post('/', zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  // Scope check
  if (user.role === 'ustadz' && data.kelas_id && !user.kelas_ids.includes(data.kelas_id)) {
    return c.json({
      error: 'Forbidden',
      code: 'KELAS_NOT_ASSIGNED',
      message: 'Anda tidak dapat menambah santri ke kelas yang tidak Anda ajar.'
    } as ApiError, 403)
  }
  if (user.role === 'ustadz' && data.kamar_id && !user.kamar_ids.includes(data.kamar_id)) {
    return c.json({
      error: 'Forbidden',
      code: 'KAMAR_NOT_ASSIGNED',
      message: 'Anda bukan wali kamar tersebut.'
    } as ApiError, 403)
  }

  // Validate kelas exists
  if (data.kelas_id) {
    const kelas = await c.env.DB.prepare('SELECT id FROM kelas WHERE id = ? AND is_active = 1').bind(data.kelas_id).first()
    if (!kelas) {
      return c.json({
        error: 'Bad Request',
        code: 'KELAS_NOT_FOUND',
        message: 'Kelas tidak ditemukan atau tidak aktif.'
      } as ApiError, 400)
    }
  }
  // Validate kamar exists
  if (data.kamar_id) {
    const kamar = await c.env.DB.prepare('SELECT id FROM kamar WHERE id = ? AND is_active = 1').bind(data.kamar_id).first()
    if (!kamar) {
      return c.json({
        error: 'Bad Request',
        code: 'KAMAR_NOT_FOUND',
        message: 'Kamar tidak ditemukan atau tidak aktif.'
      } as ApiError, 400)
    }
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO santri (id, nama_lengkap, jenis_kelamin, kelas_id, kamar_id, angkatan, tanggal_masuk, foto_url, tanggal_lahir, love_language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, data.nama_lengkap, data.jenis_kelamin,
    data.kelas_id || null, data.kamar_id || null, data.angkatan || null,
    data.tanggal_masuk || null, data.foto_url || null,
    data.tanggal_lahir || null, data.love_language || null
  ).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'santri.create', 'santri', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM santri WHERE id = ?').bind(id).first()
  return c.json({ message: 'Santri berhasil ditambahkan.', data: result }, 201)
})

// PUT /api/santri/:id
santri.put('/:id', zValidator('json', updateSchema), async (c) => {
  const santriId = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM santri WHERE id = ?').bind(santriId).first<{ kelas_id: string | null; kamar_id: string | null }>()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'SANTRI_NOT_FOUND',
      message: 'Santri tidak ditemukan.'
    } as ApiError, 404)
  }

  // Scope check
  if (user.role === 'ustadz') {
    const targetKelasId = data.kelas_id !== undefined ? data.kelas_id : existing.kelas_id
    if (targetKelasId && !user.kelas_ids.includes(targetKelasId)) {
      return c.json({
        error: 'Forbidden',
        code: 'SANTRI_NOT_IN_ASSIGNED_KELAS',
        message: 'Anda tidak memiliki akses untuk mengubah data santri ini.'
      } as ApiError, 403)
    }
    const targetKamarId = data.kamar_id !== undefined ? data.kamar_id : existing.kamar_id
    if (targetKamarId && !user.kamar_ids.includes(targetKamarId)) {
      return c.json({
        error: 'Forbidden',
        code: 'KAMAR_NOT_ASSIGNED',
        message: 'Anda bukan wali kamar tersebut.'
      } as ApiError, 403)
    }
  }

  // Validate kelas if changing
  if (data.kelas_id) {
    const kelas = await c.env.DB.prepare('SELECT id FROM kelas WHERE id = ? AND is_active = 1').bind(data.kelas_id).first()
    if (!kelas) {
      return c.json({
        error: 'Bad Request',
        code: 'KELAS_NOT_FOUND',
        message: 'Kelas tidak ditemukan atau tidak aktif.'
      } as ApiError, 400)
    }
  }
  // Validate kamar if changing
  if (data.kamar_id) {
    const kamar = await c.env.DB.prepare('SELECT id FROM kamar WHERE id = ? AND is_active = 1').bind(data.kamar_id).first()
    if (!kamar) {
      return c.json({
        error: 'Bad Request',
        code: 'KAMAR_NOT_FOUND',
        message: 'Kamar tidak ditemukan atau tidak aktif.'
      } as ApiError, 400)
    }
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
  params.push(santriId)

  await c.env.DB.prepare(
    `UPDATE santri SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'santri.update', 'santri', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, santriId, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM santri WHERE id = ?').bind(santriId).first()
  return c.json({ message: 'Data santri berhasil diperbarui.', data: result })
})

// DELETE /api/kelas/:id — soft delete (status = keluar)
santri.delete('/:id', async (c) => {
  const santriId = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM santri WHERE id = ?').bind(santriId).first<{ kelas_id: string | null }>()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'SANTRI_NOT_FOUND',
      message: 'Santri tidak ditemukan.'
    } as ApiError, 404)
  }

  // Scope check
  if (user.role === 'ustadz' && existing.kelas_id && !user.kelas_ids.includes(existing.kelas_id)) {
    return c.json({
      error: 'Forbidden',
      code: 'SANTRI_NOT_IN_ASSIGNED_KELAS',
      message: 'Anda tidak memiliki akses untuk menghapus data santri ini.'
    } as ApiError, 403)
  }

  await c.env.DB.prepare(
    "UPDATE santri SET status = 'keluar', version = version + 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(santriId).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'santri.delete', 'santri', ?)`
  ).bind(crypto.randomUUID(), user.sub, santriId).run()

  return c.json({ message: 'Santri berhasil dikeluarkan (status: keluar).' })
})

// POST /api/santri/bulk — bulk import
const bulkSchema = z.object({
  santri: z.array(createSchema).min(1).max(500)
})

santri.post('/bulk', zValidator('json', bulkSchema), async (c) => {
  const { santri: santriList } = c.req.valid('json')
  const user = c.get('user')

  const results: Array<{ row: number; status: 'created' | 'error'; id?: string; error?: string }> = []
  const kelasCache = new Map<string, boolean>()
  const kamarCache = new Map<string, boolean>()

  for (let row = 0; row < santriList.length; row++) {
    const s = santriList[row]

    if (user.role === 'ustadz' && s.kelas_id && !user.kelas_ids.includes(s.kelas_id)) {
      results.push({ row, status: 'error', error: 'KELAS_NOT_ASSIGNED' })
      continue
    }
    if (user.role === 'ustadz' && s.kamar_id && !user.kamar_ids.includes(s.kamar_id)) {
      results.push({ row, status: 'error', error: 'KAMAR_NOT_ASSIGNED' })
      continue
    }

    if (s.kelas_id) {
      let kelasValid = kelasCache.get(s.kelas_id)
      if (kelasValid === undefined) {
        const kelas = await c.env.DB.prepare(
          'SELECT id FROM kelas WHERE id = ? AND is_active = 1'
        ).bind(s.kelas_id).first()
        kelasValid = !!kelas
        kelasCache.set(s.kelas_id, kelasValid)
      }
      if (!kelasValid) {
        results.push({ row, status: 'error', error: 'KELAS_NOT_FOUND' })
        continue
      }
    }

    if (s.kamar_id) {
      let kamarValid = kamarCache.get(s.kamar_id)
      if (kamarValid === undefined) {
        const kamar = await c.env.DB.prepare(
          'SELECT id FROM kamar WHERE id = ? AND is_active = 1'
        ).bind(s.kamar_id).first()
        kamarValid = !!kamar
        kamarCache.set(s.kamar_id, kamarValid)
      }
      if (!kamarValid) {
        results.push({ row, status: 'error', error: 'KAMAR_NOT_FOUND' })
        continue
      }
    }

    try {
      const id = crypto.randomUUID()
      await c.env.DB.prepare(
        `INSERT INTO santri (id, nama_lengkap, jenis_kelamin, kelas_id, kamar_id, angkatan, tanggal_masuk, tanggal_lahir, love_language)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, s.nama_lengkap, s.jenis_kelamin,
        s.kelas_id || null, s.kamar_id || null, s.angkatan || null, s.tanggal_masuk || null,
        s.tanggal_lahir || null, s.love_language || null
      ).run()
      results.push({ row, status: 'created', id })
    } catch (err: any) {
      results.push({ row, status: 'error', error: err.message || 'UNKNOWN_ERROR' })
    }
  }

  const success = results.filter((r) => r.status === 'created').length

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'santri.bulk_create', 'santri', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, user.sub, JSON.stringify({ total: santriList.length, success })).run()

  return c.json({
    message: `${success}/${santriList.length} santri berhasil diimport.`,
    data: { results, success, total: santriList.length }
  })
})

export { santri as santriRoutes }