import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const absensi = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

absensi.use('*', authMiddleware)

const itemSchema = z.object({
  santri_id: z.string().uuid(),
  status: z.enum(['hadir', 'sakit', 'izin', 'alpa']),
  keterangan: z.string().max(500).optional()
})

const bulkSchema = z.object({
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  kegiatan_id: z.string().uuid().optional(),
  items: z.array(itemSchema).min(1).max(200)
})

const updateSchema = z.object({
  status: z.enum(['hadir', 'sakit', 'izin', 'alpa']).optional(),
  keterangan: z.string().max(500).nullable().optional()
})

// POST /api/absensi/bulk — tandai kehadiran sekelas/kegiatan sekaligus
absensi.post('/bulk', zValidator('json', bulkSchema), async (c) => {
  const { tanggal, kegiatan_id, items } = c.req.valid('json')
  const user = c.get('user')

  if (kegiatan_id) {
    const kegiatan = await c.env.DB.prepare(
      'SELECT id FROM kegiatan WHERE id = ? AND is_active = 1'
    ).bind(kegiatan_id).first()
    if (!kegiatan) {
      return c.json({
        error: 'Bad Request',
        code: 'KEGIATAN_NOT_FOUND',
        message: 'Kegiatan tidak ditemukan atau tidak aktif.'
      } as ApiError, 400)
    }
  }

  const results: Array<{ santri_id: string; status: string; id?: string; error?: string }> = []

  for (const item of items) {
    const santri = await c.env.DB.prepare(
      'SELECT id, kelas_id FROM santri WHERE id = ?'
    ).bind(item.santri_id).first<{ id: string; kelas_id: string | null }>()

    if (!santri) {
      results.push({ santri_id: item.santri_id, status: 'error', error: 'SANTRI_NOT_FOUND' })
      continue
    }

    if (user.role === 'ustadz' && santri.kelas_id && !user.kelas_ids.includes(santri.kelas_id)) {
      results.push({ santri_id: item.santri_id, status: 'error', error: 'KELAS_NOT_ASSIGNED' })
      continue
    }

    const existing = await c.env.DB.prepare(
      'SELECT id FROM absensi WHERE santri_id = ? AND tanggal = ? AND kegiatan_id IS ?'
    ).bind(item.santri_id, tanggal, kegiatan_id || null).first<{ id: string }>()

    if (existing) {
      await c.env.DB.prepare(
        `UPDATE absensi SET status = ?, keterangan = ?, dicatat_oleh = ?, version = version + 1, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(item.status, item.keterangan || null, user.sub, existing.id).run()
      results.push({ santri_id: item.santri_id, status: 'updated', id: existing.id })
    } else {
      const id = crypto.randomUUID()
      await c.env.DB.prepare(
        `INSERT INTO absensi (id, santri_id, tanggal, kegiatan_id, status, keterangan, dicatat_oleh)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, item.santri_id, tanggal, kegiatan_id || null, item.status, item.keterangan || null, user.sub).run()
      results.push({ santri_id: item.santri_id, status: 'created', id })
    }
  }

  const success = results.filter((r) => r.status === 'created' || r.status === 'updated').length

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'absensi.bulk_mark', 'absensi', ?, ?)`
  ).bind(
    crypto.randomUUID(), user.sub, user.sub,
    JSON.stringify({ tanggal, kegiatan_id: kegiatan_id || null, total: items.length, success })
  ).run()

  return c.json({
    message: `${success}/${items.length} absensi berhasil disimpan.`,
    data: { results, success, total: items.length }
  })
})

// GET /api/absensi — scoped by role, filter by santri_id/kelas_id/tanggal/rentang/kegiatan_id
absensi.get('/', async (c) => {
  const user = c.get('user')
  const { santri_id, kelas_id, tanggal, dari, sampai, kegiatan_id, cursor, limit } = c.req.query()

  const conditions: string[] = []
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
    conditions.push('a.santri_id = ?')
    params.push(santri_id)
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
  if (tanggal) {
    conditions.push('a.tanggal = ?')
    params.push(tanggal)
  } else {
    if (dari) { conditions.push('a.tanggal >= ?'); params.push(dari) }
    if (sampai) { conditions.push('a.tanggal <= ?'); params.push(sampai) }
  }
  if (kegiatan_id) {
    conditions.push('a.kegiatan_id = ?')
    params.push(kegiatan_id)
  }
  if (cursor) {
    conditions.push('a.id > ?')
    params.push(cursor)
  }

  const pageLimit = Math.min(parseInt(limit || '50'), 200)
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const query = `
    SELECT a.*, s.nama_lengkap as santri_nama, s.kelas_id, g.nama as kegiatan_nama
    FROM absensi a
    INNER JOIN santri s ON a.santri_id = s.id
    LEFT JOIN kegiatan g ON a.kegiatan_id = g.id
    ${where}
    ORDER BY a.tanggal DESC, a.id ASC
    LIMIT ?
  `
  params.push(pageLimit + 1)

  const dbResult = await c.env.DB.prepare(query).bind(...params).all<{ id: string }>()
  const results = dbResult.results || []
  const hasMore = results.length > pageLimit
  const data = hasMore ? results.slice(0, pageLimit) : results
  const nextCursor = hasMore ? data[data.length - 1]?.id : null

  return c.json({ data, pagination: { cursor: nextCursor, hasMore } })
})

// GET /api/absensi/rekap — rekap jumlah per status, untuk dashboard
absensi.get('/rekap', async (c) => {
  const user = c.get('user')
  const { kelas_id, dari, sampai } = c.req.query()

  if (!dari || !sampai) {
    return c.json({
      error: 'Bad Request',
      code: 'MISSING_RANGE',
      message: 'Parameter "dari" dan "sampai" (YYYY-MM-DD) wajib diisi.'
    } as ApiError, 400)
  }

  const conditions: string[] = ['a.tanggal BETWEEN ? AND ?']
  const params: unknown[] = [dari, sampai]

  if (user.role === 'ustadz') {
    if (user.kelas_ids.length === 0) {
      return c.json({ data: [] })
    }
    const ph = user.kelas_ids.map(() => '?').join(',')
    conditions.push(`s.kelas_id IN (${ph})`)
    params.push(...user.kelas_ids)
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

  const query = `
    SELECT a.status, COUNT(*) as jumlah
    FROM absensi a
    INNER JOIN santri s ON a.santri_id = s.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY a.status
  `
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ data: result.results || [] })
})

// PUT /api/absensi/:id — koreksi satu catatan
absensi.put('/:id', zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(`
    SELECT a.*, s.kelas_id
    FROM absensi a
    INNER JOIN santri s ON a.santri_id = s.id
    WHERE a.id = ?
  `).bind(id).first<{ kelas_id: string | null }>()

  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'ABSENSI_NOT_FOUND',
      message: 'Data absensi tidak ditemukan.'
    } as ApiError, 404)
  }

  if (user.role === 'ustadz' && existing.kelas_id && !user.kelas_ids.includes(existing.kelas_id)) {
    return c.json({
      error: 'Forbidden',
      code: 'KELAS_NOT_ASSIGNED',
      message: 'Anda tidak memiliki akses untuk mengubah absensi ini.'
    } as ApiError, 403)
  }

  const updates: string[] = []
  const params: unknown[] = []
  if (data.status !== undefined) { updates.push('status = ?'); params.push(data.status) }
  if (data.keterangan !== undefined) { updates.push('keterangan = ?'); params.push(data.keterangan) }

  if (updates.length === 0) {
    return c.json({ message: 'Tidak ada perubahan.', data: existing })
  }

  updates.push('dicatat_oleh = ?')
  params.push(user.sub)
  updates.push('version = version + 1')
  updates.push("updated_at = datetime('now')")
  params.push(id)

  await c.env.DB.prepare(`UPDATE absensi SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'absensi.update', 'absensi', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM absensi WHERE id = ?').bind(id).first()
  return c.json({ message: 'Absensi berhasil diperbarui.', data: result })
})

export { absensi as absensiRoutes }
