import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireCanMutate } from '../middleware/auth'
import { resolveKamarScope, canAccessKamar } from '../lib/scope'
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

// POST /api/absensi/bulk — tandai kehadiran sekamar/kegiatan sekaligus
// Absensi ini berbasis KAMAR (wali kamar), bukan kelas — kelas dipertahankan
// khusus buat catatan disiplin akademik (lihat routes/catatan.ts).
absensi.post('/bulk', requireCanMutate(), zValidator('json', bulkSchema), async (c) => {
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
      'SELECT id, kamar_id FROM santri WHERE id = ?'
    ).bind(item.santri_id).first<{ id: string; kamar_id: string | null }>()

    if (!santri) {
      results.push({ santri_id: item.santri_id, status: 'error', error: 'SANTRI_NOT_FOUND' })
      continue
    }

    if (user.role === 'ustadz' && (!santri.kamar_id || !user.kamar_ids.includes(santri.kamar_id))) {
      results.push({ santri_id: item.santri_id, status: 'error', error: 'KAMAR_NOT_ASSIGNED' })
      continue
    }
    if (user.role === 'kepala_asrama' && !(await canAccessKamar(c.env, user, santri.kamar_id))) {
      results.push({ santri_id: item.santri_id, status: 'error', error: 'KAMAR_NOT_IN_ASRAMA' })
      continue
    }

    // UPSERT — race-safe via ON CONFLICT (replaces SELECT-then-INSERT)
    const newId = crypto.randomUUID()
    await c.env.DB.prepare(
      `INSERT INTO absensi (id, santri_id, tanggal, kegiatan_id, status, keterangan, dicatat_oleh)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(santri_id, tanggal, COALESCE(kegiatan_id, '')) DO UPDATE SET
         status = excluded.status, keterangan = excluded.keterangan, dicatat_oleh = excluded.dicatat_oleh,
         version = version + 1, updated_at = datetime('now')`
    ).bind(newId, item.santri_id, tanggal, kegiatan_id || null, item.status, item.keterangan || null, user.sub).run()

    const row = await c.env.DB.prepare(
      `SELECT id FROM absensi WHERE santri_id = ? AND tanggal = ? AND COALESCE(kegiatan_id, '') = COALESCE(?, '')`
    ).bind(item.santri_id, tanggal, kegiatan_id || null).first<{ id: string }>()

    const wasCreated = row?.id === newId
    results.push({ santri_id: item.santri_id, status: wasCreated ? 'created' : 'updated', id: row?.id || newId })
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

// GET /api/absensi — scoped by role (kamar), filter by santri_id/kamar_id/tanggal/rentang/kegiatan_id
absensi.get('/', async (c) => {
  const user = c.get('user')
  const { santri_id, kamar_id, tanggal, dari, sampai, kegiatan_id, cursor, limit } = c.req.query()

  const conditions: string[] = []
  const params: unknown[] = []

  // Scope: ustadz/kepala_asrama by kamar. kyai/admin = global.
  const scopedKamarIds = await resolveKamarScope(c.env, user)
  if (scopedKamarIds !== null) {
    if (scopedKamarIds.length === 0) {
      return c.json({ data: [], pagination: { cursor: null, hasMore: false } })
    }
    const ph = scopedKamarIds.map(() => '?').join(',')
    conditions.push(`s.kamar_id IN (${ph})`)
    params.push(...scopedKamarIds)
  }

  if (santri_id) {
    conditions.push('a.santri_id = ?')
    params.push(santri_id)
  }
  if (kamar_id) {
    if (!(await canAccessKamar(c.env, user, kamar_id))) {
      return c.json({
        error: 'Forbidden',
        code: 'KAMAR_NOT_ASSIGNED',
        message: 'Anda tidak memiliki akses ke kamar ini.'
      } as ApiError, 403)
    }
    conditions.push('s.kamar_id = ?')
    params.push(kamar_id)
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

  const pageLimit = Math.min(Math.max(parseInt(limit || '50') || 50, 1), 200)
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const query = `
    SELECT a.*, s.nama_lengkap as santri_nama, s.kamar_id, g.nama as kegiatan_nama
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
  const { kamar_id, dari, sampai } = c.req.query()

  if (!dari || !sampai) {
    return c.json({
      error: 'Bad Request',
      code: 'MISSING_RANGE',
      message: 'Parameter "dari" dan "sampai" (YYYY-MM-DD) wajib diisi.'
    } as ApiError, 400)
  }

  const conditions: string[] = ['a.tanggal BETWEEN ? AND ?']
  const params: unknown[] = [dari, sampai]

  const scopedKamarIds = await resolveKamarScope(c.env, user)
  if (scopedKamarIds !== null) {
    if (scopedKamarIds.length === 0) {
      return c.json({ data: [] })
    }
    const ph = scopedKamarIds.map(() => '?').join(',')
    conditions.push(`s.kamar_id IN (${ph})`)
    params.push(...scopedKamarIds)
  }

  if (kamar_id) {
    if (!(await canAccessKamar(c.env, user, kamar_id))) {
      return c.json({
        error: 'Forbidden',
        code: 'KAMAR_NOT_ASSIGNED',
        message: 'Anda tidak memiliki akses ke kamar ini.'
      } as ApiError, 403)
    }
    conditions.push('s.kamar_id = ?')
    params.push(kamar_id)
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
absensi.put('/:id', requireCanMutate(), zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(`
    SELECT a.*, s.kamar_id
    FROM absensi a
    INNER JOIN santri s ON a.santri_id = s.id
    WHERE a.id = ?
  `).bind(id).first<{ kamar_id: string | null }>()

  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'ABSENSI_NOT_FOUND',
      message: 'Data absensi tidak ditemukan.'
    } as ApiError, 404)
  }

  if (user.role === 'ustadz' && (!existing.kamar_id || !user.kamar_ids.includes(existing.kamar_id))) {
    return c.json({
      error: 'Forbidden',
      code: 'KAMAR_NOT_ASSIGNED',
      message: 'Anda tidak memiliki akses untuk mengubah absensi ini.'
    } as ApiError, 403)
  }
  if (user.role === 'kepala_asrama' && !(await canAccessKamar(c.env, user, existing.kamar_id))) {
    return c.json({
      error: 'Forbidden',
      code: 'KAMAR_NOT_IN_ASRAMA',
      message: 'Absensi ini di luar lingkup asrama Anda.'
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
