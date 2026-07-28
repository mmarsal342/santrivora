import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireAnyRole } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const personel = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

personel.use('*', authMiddleware)
// Profil & catatan personel: khusus admin & kyai (termasuk kyai, beda dari
// requireCanMutate yang menolak kyai di endpoint lain — di sini kyai memang
// salah satu penulis utama catatan personel).
personel.use('*', requireAnyRole('admin', 'kyai'))

const KATEGORI_OPTIONS = ['Kinerja', 'Kehadiran', 'Pelanggaran', 'Prestasi', 'Keputusan Kyai', 'Lainnya'] as const

const createSchema = z.object({
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

async function attachAssignments<T extends { id: string }>(env: Env, rows: T[]) {
  const ids = rows.map((r) => r.id)
  const kelasMap = new Map<string, Array<{ id: string; nama: string; tingkatan: string | null }>>()
  const kamarMap = new Map<string, Array<{ id: string; nama: string; jenis_kelamin: string }>>()

  if (ids.length > 0) {
    const ph = ids.map(() => '?').join(',')
    const [kelasRows, kamarRows] = await Promise.all([
      env.DB.prepare(
        `SELECT uk.user_id, k.id, k.nama, k.tingkatan
         FROM ustadz_kelas uk JOIN kelas k ON uk.kelas_id = k.id
         WHERE uk.user_id IN (${ph})`
      ).bind(...ids).all<{ user_id: string; id: string; nama: string; tingkatan: string | null }>(),
      env.DB.prepare(
        `SELECT uk.user_id, k.id, k.nama, k.jenis_kelamin
         FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id
         WHERE uk.user_id IN (${ph})`
      ).bind(...ids).all<{ user_id: string; id: string; nama: string; jenis_kelamin: string }>()
    ])
    for (const row of kelasRows.results || []) {
      if (!kelasMap.has(row.user_id)) kelasMap.set(row.user_id, [])
      kelasMap.get(row.user_id)!.push({ id: row.id, nama: row.nama, tingkatan: row.tingkatan })
    }
    for (const row of kamarRows.results || []) {
      if (!kamarMap.has(row.user_id)) kamarMap.set(row.user_id, [])
      kamarMap.get(row.user_id)!.push({ id: row.id, nama: row.nama, jenis_kelamin: row.jenis_kelamin })
    }
  }

  return rows.map((r) => ({
    ...r,
    assigned_kelas: kelasMap.get(r.id) || [],
    assigned_kamar: kamarMap.get(r.id) || []
  }))
}

// GET /api/personel — daftar semua personel + penugasan kelas/kamar
personel.get('/', async (c) => {
  const role = c.req.query('role')
  const status = c.req.query('status')
  const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200)
  const offset = (page - 1) * limit

  const whereParts: string[] = []
  const params: (string | number)[] = []
  if (role) { whereParts.push('role = ?'); params.push(role) }
  if (status) { whereParts.push('status = ?'); params.push(status) }
  const where = whereParts.length > 0 ? ' WHERE ' + whereParts.join(' AND ') : ''

  const [rows, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, email, nama_lengkap, role, asrama_jenis, status, last_login, created_at
       FROM users${where} ORDER BY nama_lengkap ASC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all<{ id: string }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as total FROM users${where}`).bind(...params).first<{ total: number }>()
  ])

  const data = await attachAssignments(c.env, rows.results || [])

  return c.json({
    data,
    pagination: {
      page,
      limit,
      total: total?.total || 0,
      total_pages: Math.ceil((total?.total || 0) / limit)
    }
  })
})

// GET /api/personel/:id — profil lengkap: identitas + penugasan + ringkasan aktivitas
personel.get('/:id', async (c) => {
  const id = c.req.param('id')

  const user = await c.env.DB.prepare(
    'SELECT id, email, nama_lengkap, role, asrama_jenis, status, last_login, created_at, updated_at FROM users WHERE id = ?'
  ).bind(id).first<{
    id: string
    email: string
    nama_lengkap: string
    role: string
    asrama_jenis: string | null
    status: string
    last_login: string | null
    created_at: string
    updated_at: string
  }>()

  if (!user) {
    return c.json({ error: 'Not Found', code: 'PERSONEL_NOT_FOUND', message: 'Personel tidak ditemukan.' } as ApiError, 404)
  }

  const [assigned, aktivitas] = await Promise.all([
    attachAssignments(c.env, [user]),
    Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as c FROM catatan_disiplin WHERE dicatat_oleh = ? AND is_deleted = 0').bind(id).first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM catatan_perkembangan WHERE dicatat_oleh = ? AND is_deleted = 0').bind(id).first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM absensi WHERE dicatat_oleh = ?').bind(id).first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM kegiatan WHERE created_by = ?').bind(id).first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM pesan WHERE pengirim_id = ?').bind(id).first<{ c: number }>()
    ])
  ])

  const [catatanDisiplin, catatanPerkembangan, absensi, kegiatan, pesanTerkirim] = aktivitas

  return c.json({
    data: {
      ...assigned[0],
      aktivitas: {
        catatan_disiplin_dicatat: catatanDisiplin?.c || 0,
        catatan_perkembangan_dicatat: catatanPerkembangan?.c || 0,
        absensi_dicatat: absensi?.c || 0,
        kegiatan_dibuat: kegiatan?.c || 0,
        pesan_terkirim: pesanTerkirim?.c || 0
      }
    }
  })
})

// GET /api/personel/:id/catatan — daftar catatan personel
personel.get('/:id/catatan', async (c) => {
  const id = c.req.param('id')

  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first()
  if (!exists) {
    return c.json({ error: 'Not Found', code: 'PERSONEL_NOT_FOUND', message: 'Personel tidak ditemukan.' } as ApiError, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT cp.*, u.nama_lengkap as dicatat_oleh_nama
     FROM catatan_personel cp
     LEFT JOIN users u ON cp.dicatat_oleh = u.id
     WHERE cp.personel_id = ? AND cp.is_deleted = 0
     ORDER BY cp.tanggal DESC, cp.created_at DESC
     LIMIT 200`
  ).bind(id).all()

  return c.json({ data: result.results || [] })
})

// GET /api/personel/:id/santri-riwayat — santri yang pernah diasuh (via kamar,
// hitung dari overlap periode riwayat_kamar_personel x riwayat_kamar_santri).
// kelas tidak diikutkan: ustadz_kelas tidak lagi punya jalur assignment aktif
// di aplikasi ini (legacy), jadi tidak ada apa pun untuk dilacak riwayatnya.
personel.get('/:id/santri-riwayat', async (c) => {
  const id = c.req.param('id')

  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first()
  if (!exists) {
    return c.json({ error: 'Not Found', code: 'PERSONEL_NOT_FOUND', message: 'Personel tidak ditemukan.' } as ApiError, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT
       s.id as santri_id, s.nama_lengkap, s.status as santri_status,
       rp.kamar_id, k.nama as kamar_nama,
       MAX(rp.mulai_at, rks.mulai_at) as mulai_bersama,
       CASE
         WHEN rp.selesai_at IS NULL AND rks.selesai_at IS NULL THEN NULL
         WHEN rp.selesai_at IS NULL THEN rks.selesai_at
         WHEN rks.selesai_at IS NULL THEN rp.selesai_at
         ELSE MIN(rp.selesai_at, rks.selesai_at)
       END as selesai_bersama
     FROM riwayat_kamar_personel rp
     JOIN riwayat_kamar_santri rks
       ON rks.kamar_id = rp.kamar_id
       AND rks.mulai_at < COALESCE(rp.selesai_at, '9999-12-31')
       AND rp.mulai_at < COALESCE(rks.selesai_at, '9999-12-31')
     JOIN santri s ON s.id = rks.santri_id
     JOIN kamar k ON k.id = rp.kamar_id
     WHERE rp.user_id = ?
     ORDER BY mulai_bersama DESC
     LIMIT 500`
  ).bind(id).all<{ selesai_bersama: string | null }>()

  const data = (result.results || []).map((row) => ({ ...row, masih_diasuh: row.selesai_bersama === null }))

  return c.json({ data })
})

// POST /api/personel/:id/catatan
personel.post('/:id/catatan', zValidator('json', createSchema), async (c) => {
  const personelId = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(personelId).first()
  if (!exists) {
    return c.json({ error: 'Not Found', code: 'PERSONEL_NOT_FOUND', message: 'Personel tidak ditemukan.' } as ApiError, 404)
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO catatan_personel (id, personel_id, tanggal, kategori, judul, catatan, dicatat_oleh)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, personelId, data.tanggal, data.kategori, data.judul, data.catatan || null, user.sub).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'catatan_personel.create', 'catatan_personel', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify({ personel_id: personelId, ...data })).run()

  const result = await c.env.DB.prepare('SELECT * FROM catatan_personel WHERE id = ?').bind(id).first()
  return c.json({ message: 'Catatan personel berhasil ditambahkan.', data: result }, 201)
})

// PUT /api/personel/catatan/:id
personel.put('/catatan/:id', zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(
    'SELECT * FROM catatan_personel WHERE id = ? AND is_deleted = 0'
  ).bind(id).first()

  if (!existing) {
    return c.json({ error: 'Not Found', code: 'CATATAN_NOT_FOUND', message: 'Catatan tidak ditemukan.' } as ApiError, 404)
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

  await c.env.DB.prepare(
    `UPDATE catatan_personel SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'catatan_personel.update', 'catatan_personel', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM catatan_personel WHERE id = ?').bind(id).first()
  return c.json({ message: 'Catatan personel berhasil diperbarui.', data: result })
})

// DELETE /api/personel/catatan/:id (soft delete)
personel.delete('/catatan/:id', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(
    'SELECT * FROM catatan_personel WHERE id = ? AND is_deleted = 0'
  ).bind(id).first()

  if (!existing) {
    return c.json({ error: 'Not Found', code: 'CATATAN_NOT_FOUND', message: 'Catatan tidak ditemukan.' } as ApiError, 404)
  }

  await c.env.DB.prepare(
    "UPDATE catatan_personel SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'catatan_personel.delete', 'catatan_personel', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Catatan personel berhasil dihapus.' })
})

export { personel as personelRoutes }
