import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireCanMutate } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const catatanPerkembangan = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

catatanPerkembangan.use('*', authMiddleware)

const KATEGORI_OPTIONS = ['Perkembangan', 'Kesehatan', 'Keluarga', 'Sosial', 'Akademik', 'Spiritual'] as const

const createSchema = z.object({
  santri_id: z.string().uuid(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  kategori: z.enum(KATEGORI_OPTIONS),
  judul: z.string().min(1, 'Judul wajib diisi').max(300),
  catatan: z.string().max(2000).optional()
})

const updateSchema = z.object({
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kategori: z.enum(KATEGORI_OPTIONS).optional(),
  judul: z.string().min(1).max(300).optional(),
  catatan: z.string().max(2000).nullable().optional()
})

async function assertAccess(
  env: Env,
  user: UserPayload,
  santriId: string
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  const santri = await env.DB.prepare(
    'SELECT kamar_id, kelas_id FROM santri WHERE id = ?'
  ).bind(santriId).first<{ kamar_id: string | null; kelas_id: string | null }>()

  if (!santri) return { ok: false, reason: 'SANTRI_NOT_FOUND', status: 404 }

  // admin & kyai = global
  if (user.role === 'admin' || user.role === 'kyai') return { ok: true }

  // kepala_asrama: santri harus di kamar asramanya
  if (user.role === 'kepala_asrama') {
    if (santri.kamar_id && user.asrama_jenis) {
      const k = await env.DB.prepare('SELECT jenis_kelamin FROM kamar WHERE id = ?').bind(santri.kamar_id).first<{ jenis_kelamin: string }>()
      if (k && k.jenis_kelamin === user.asrama_jenis) return { ok: true }
    }
    return { ok: false, reason: 'NOT_ASSIGNED', status: 403 }
  }

  // ustadz: kamar atau kelas
  if (santri.kamar_id && user.kamar_ids.includes(santri.kamar_id)) return { ok: true }
  if (santri.kelas_id && user.kelas_ids.includes(santri.kelas_id)) return { ok: true }

  return { ok: false, reason: 'NOT_ASSIGNED', status: 403 }
}

function errorResponse(reason: string, status: number): Response {
  const messages: Record<string, string> = {
    SANTRI_NOT_FOUND: 'Santri tidak ditemukan.',
    NOT_ASSIGNED: 'Anda tidak memiliki akses ke santri ini.'
  }
  return Response.json({
    error: status === 404 ? 'Not Found' : 'Forbidden',
    code: reason,
    message: messages[reason] || 'Akses ditolak.'
  } as ApiError, { status })
}

// GET /api/catatan-perkembangan?santri_id=...
catatanPerkembangan.get('/', async (c) => {
  const user = c.get('user')
  const santriId = c.req.query('santri_id')

  if (!santriId) {
    return c.json({
      error: 'Bad Request',
      code: 'MISSING_SANTRI_ID',
      message: 'Parameter "santri_id" wajib diisi.'
    } as ApiError, 400)
  }

  const access = await assertAccess(c.env, user, santriId)
  if (!access.ok) return errorResponse(access.reason, access.status)

  const result = await c.env.DB.prepare(
    `SELECT cp.*, u.nama_lengkap as dicatat_oleh_nama
     FROM catatan_perkembangan cp
     LEFT JOIN users u ON cp.dicatat_oleh = u.id
     WHERE cp.santri_id = ? AND cp.is_deleted = 0
     ORDER BY cp.tanggal DESC, cp.created_at DESC
     LIMIT 200`
  ).bind(santriId).all()

  return c.json({ data: result.results || [] })
})

// POST /api/catatan-perkembangan
catatanPerkembangan.post('/', requireCanMutate(), zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  const access = await assertAccess(c.env, user, data.santri_id)
  if (!access.ok) return errorResponse(access.reason, access.status)

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO catatan_perkembangan (id, santri_id, tanggal, kategori, judul, catatan, dicatat_oleh)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, data.santri_id, data.tanggal, data.kategori, data.judul, data.catatan || null, user.sub).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'catatan_perkembangan.create', 'catatan_perkembangan', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare(
    'SELECT * FROM catatan_perkembangan WHERE id = ?'
  ).bind(id).first()

  return c.json({ message: 'Catatan perkembangan berhasil ditambahkan.', data: result }, 201)
})

// PUT /api/catatan-perkembangan/:id
catatanPerkembangan.put('/:id', requireCanMutate(), zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(
    'SELECT * FROM catatan_perkembangan WHERE id = ? AND is_deleted = 0'
  ).bind(id).first<{ santri_id: string }>()

  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'CATATAN_NOT_FOUND',
      message: 'Catatan tidak ditemukan.'
    } as ApiError, 404)
  }

  const access = await assertAccess(c.env, user, existing.santri_id)
  if (!access.ok) return errorResponse(access.reason, access.status)

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

  await c.env.DB.prepare(
    `UPDATE catatan_perkembangan SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'catatan_perkembangan.update', 'catatan_perkembangan', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare(
    'SELECT * FROM catatan_perkembangan WHERE id = ?'
  ).bind(id).first()

  return c.json({ message: 'Catatan perkembangan berhasil diperbarui.', data: result })
})

// DELETE /api/catatan-perkembangan/:id (soft delete)
catatanPerkembangan.delete('/:id', requireCanMutate(), async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(
    'SELECT * FROM catatan_perkembangan WHERE id = ? AND is_deleted = 0'
  ).bind(id).first<{ santri_id: string }>()

  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'CATATAN_NOT_FOUND',
      message: 'Catatan tidak ditemukan.'
    } as ApiError, 404)
  }

  const access = await assertAccess(c.env, user, existing.santri_id)
  if (!access.ok) return errorResponse(access.reason, access.status)

  await c.env.DB.prepare(
    "UPDATE catatan_perkembangan SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'catatan_perkembangan.delete', 'catatan_perkembangan', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Catatan perkembangan berhasil dihapus.' })
})

export { catatanPerkembangan as catatanPerkembanganRoutes }
