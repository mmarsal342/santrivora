import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireCanMutate } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const catatanHaid = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

catatanHaid.use('*', authMiddleware)

const upsertSchema = z.object({
  santri_id: z.string().uuid(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  status: z.enum(['suci', 'haid']),
  catatan: z.string().max(500).optional()
})

// Admin & kyai (global), kepala_asrama putri (asramanya), serta wali kamar dari
// kamar berjenis_kelamin 'P' saja yang boleh akses data ini.
// Cek langsung ke DB supaya perubahan assignment terbaru ikut kepakai walau token lama.
async function assertHaidAccess(
  env: Env,
  user: UserPayload,
  santriId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const santri = await env.DB.prepare(
    'SELECT kamar_id, jenis_kelamin FROM santri WHERE id = ?'
  ).bind(santriId).first<{ kamar_id: string | null; jenis_kelamin: string }>()

  if (!santri) return { ok: false, reason: 'SANTRI_NOT_FOUND' }
  // Gender check applies to everyone, including admin — this data simply
  // doesn't make sense for a male santri regardless of who's writing it.
  if (santri.jenis_kelamin !== 'P') return { ok: false, reason: 'SANTRI_NOT_FEMALE' }

  // admin = global read access. Kyai tidak lihat detail haid (data sensitif).
  if (user.role === 'admin') return { ok: true }
  if (user.role === 'kyai') return { ok: false, reason: 'NOT_WALI_KAMAR_PUTRI' }

  // kepala_asrama hanya yang putri
  if (user.role === 'kepala_asrama') {
    return user.asrama_jenis === 'P' ? { ok: true } : { ok: false, reason: 'NOT_WALI_KAMAR_PUTRI' }
  }

  // ustadz: cek assignment wali kamar putri via DB
  if (!santri.kamar_id) return { ok: false, reason: 'SANTRI_NO_KAMAR' }

  const waliKamar = await env.DB.prepare(
    `SELECT uk.user_id FROM ustadz_kamar uk
     JOIN kamar k ON uk.kamar_id = k.id
     WHERE uk.kamar_id = ? AND uk.user_id = ? AND k.jenis_kelamin = 'P'`
  ).bind(santri.kamar_id, user.sub).first()

  if (!waliKamar) return { ok: false, reason: 'NOT_WALI_KAMAR_PUTRI' }
  return { ok: true }
}

function forbidden(reason: string): ApiError {
  const messages: Record<string, string> = {
    SANTRI_NOT_FOUND: 'Santri tidak ditemukan.',
    SANTRI_NOT_FEMALE: 'Data ini hanya berlaku untuk santri putri.',
    SANTRI_NO_KAMAR: 'Santri belum ditempatkan di kamar manapun.',
    NOT_WALI_KAMAR_PUTRI: 'Hanya admin dan wali kamar putri santri ini yang dapat mengakses data ini.'
  }
  return {
    error: 'Forbidden',
    code: reason,
    message: messages[reason] || 'Akses ditolak.'
  }
}

// GET /api/catatan-haid?santri_id=... — riwayat suci/haid seorang santri
catatanHaid.get('/', async (c) => {
  const user = c.get('user')
  const santriId = c.req.query('santri_id')

  if (!santriId) {
    return c.json({
      error: 'Bad Request',
      code: 'MISSING_SANTRI_ID',
      message: 'Parameter "santri_id" wajib diisi.'
    } as ApiError, 400)
  }

  const access = await assertHaidAccess(c.env, user, santriId)
  if (!access.ok) {
    const status = access.reason === 'SANTRI_NOT_FOUND' ? 404 : 403
    return c.json(forbidden(access.reason), status)
  }

  const result = await c.env.DB.prepare(
    'SELECT * FROM catatan_haid WHERE santri_id = ? ORDER BY tanggal DESC LIMIT 100'
  ).bind(santriId).all()

  return c.json({ data: result.results || [] })
})

// POST /api/catatan-haid — catat/update status untuk satu tanggal (upsert per hari)
catatanHaid.post('/', requireCanMutate(), zValidator('json', upsertSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  const access = await assertHaidAccess(c.env, user, data.santri_id)
  if (!access.ok) {
    const status = access.reason === 'SANTRI_NOT_FOUND' ? 404 : 403
    return c.json(forbidden(access.reason), status)
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM catatan_haid WHERE santri_id = ? AND tanggal = ?'
  ).bind(data.santri_id, data.tanggal).first<{ id: string }>()

  let id: string
  if (existing) {
    id = existing.id
    await c.env.DB.prepare(
      `UPDATE catatan_haid SET status = ?, catatan = ?, dicatat_oleh = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(data.status, data.catatan || null, user.sub, id).run()
  } else {
    id = crypto.randomUUID()
    await c.env.DB.prepare(
      `INSERT INTO catatan_haid (id, santri_id, tanggal, status, catatan, dicatat_oleh)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, data.santri_id, data.tanggal, data.status, data.catatan || null, user.sub).run()
  }

  // Audit log tanpa detail status/catatan — ini data kesehatan sensitif,
  // cukup catat bahwa perubahan terjadi dan siapa yang melakukannya.
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'catatan_haid.upsert', 'catatan_haid', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  const result = await c.env.DB.prepare('SELECT * FROM catatan_haid WHERE id = ?').bind(id).first()
  return c.json({ message: 'Catatan berhasil disimpan.', data: result }, existing ? 200 : 201)
})

// DELETE /api/catatan-haid/:id — koreksi kesalahan input
catatanHaid.delete('/:id', requireCanMutate(), async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(
    'SELECT * FROM catatan_haid WHERE id = ?'
  ).bind(id).first<{ santri_id: string }>()

  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'CATATAN_NOT_FOUND',
      message: 'Catatan tidak ditemukan.'
    } as ApiError, 404)
  }

  const access = await assertHaidAccess(c.env, user, existing.santri_id)
  if (!access.ok) {
    return c.json(forbidden(access.reason), 403)
  }

  await c.env.DB.prepare('DELETE FROM catatan_haid WHERE id = ?').bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'catatan_haid.delete', 'catatan_haid', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Catatan berhasil dihapus.' })
})

export { catatanHaid as catatanHaidRoutes }
