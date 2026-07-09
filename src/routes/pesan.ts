import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireAnyRole } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const pesan = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

pesan.use('*', authMiddleware)

const sendSchema = z.object({
  judul: z.string().min(1, 'Judul wajib diisi').max(200),
  isi: z.string().min(1, 'Isi pesan wajib diisi').max(5000),
  prioritas: z.enum(['biasa', 'penting']).optional(),
  penerima_id: z.string().uuid().optional(),
  asrama_jenis: z.enum(['L', 'P']).optional()
})

// POST /api/pesan — kirim pesan. Hanya kyai & admin.
pesan.post('/', requireAnyRole('kyai', 'admin'), zValidator('json', sendSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  // Validasi penerima: bila penerima_id diisi → pesan langsung. Cek user tujuan valid.
  let penerimaId: string | null = data.penerima_id || null
  let asramaJenis: string | null = data.asrama_jenis || null

  if (penerimaId) {
    const target = await c.env.DB.prepare(
      "SELECT id FROM users WHERE id = ? AND status = 'approved'"
    ).bind(penerimaId).first<{ id: string }>()
    if (!target) {
      return c.json({
        error: 'Bad Request',
        code: 'PENERIMA_NOT_FOUND',
        message: 'Penerima tidak ditemukan.'
      } as ApiError, 400)
    }
    asramaJenis = null // direct → abaikan asrama
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO pesan (id, pengirim_id, penerima_id, asrama_jenis, judul, isi, prioritas)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.sub, penerimaId, asramaJenis, data.judul, data.isi, data.prioritas || 'biasa').run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'pesan.create', 'pesan', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify({
    judul: data.judul,
    penerima_id: penerimaId,
    asrama_jenis: asramaJenis,
    prioritas: data.prioritas || 'biasa'
  })).run()

  const result = await c.env.DB.prepare('SELECT * FROM pesan WHERE id = ?').bind(id).first()
  return c.json({ message: 'Pesan berhasil dikirim.', data: result }, 201)
})

// GET /api/pesan/inbox — kotak masuk ustadz (semua role bisa lihat).
// Pesan masuk = direct ke saya, broadcast semua, atau broadcast asrama saya.
pesan.get('/inbox', async (c) => {
  const user = c.get('user')
  const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200)
  const offset = (page - 1) * limit

  const rows = await c.env.DB.prepare(
    `SELECT p.*, u.nama_lengkap as pengirim_nama,
            CASE WHEN pd.pesan_id IS NOT NULL THEN 1 ELSE 0 END as sudah_dibaca
     FROM pesan p
     LEFT JOIN users u ON p.pengirim_id = u.id
     LEFT JOIN pesan_dibaca pd ON pd.pesan_id = p.id AND pd.user_id = ?
     WHERE
       p.penerima_id = ?
       OR (p.penerima_id IS NULL AND p.asrama_jenis IS NULL)
       OR (p.penerima_id IS NULL AND p.asrama_jenis IN (
            SELECT k.jenis_kelamin FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id WHERE uk.user_id = ?
       ))
       OR (p.penerima_id IS NULL AND p.asrama_jenis = ?)
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(user.sub, user.sub, user.sub, user.asrama_jenis || '', limit, offset).all()

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM pesan p
     WHERE
       p.penerima_id = ?
       OR (p.penerima_id IS NULL AND p.asrama_jenis IS NULL)
       OR (p.penerima_id IS NULL AND p.asrama_jenis IN (
            SELECT k.jenis_kelamin FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id WHERE uk.user_id = ?
       ))
       OR (p.penerima_id IS NULL AND p.asrama_jenis = ?)`
  ).bind(user.sub, user.sub, user.asrama_jenis || '').first<{ count: number }>()

  return c.json({
    data: rows.results || [],
    pagination: {
      page,
      limit,
      total: total?.count || 0,
      total_pages: Math.ceil((total?.count || 0) / limit)
    }
  })
})

// GET /api/pesan/unread-count — jumlah pesan belum dibaca (buat badge)
pesan.get('/unread-count', async (c) => {
  const user = c.get('user')

  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM pesan p
     WHERE
       ((p.penerima_id = ?
         OR (p.penerima_id IS NULL AND p.asrama_jenis IS NULL)
         OR (p.penerima_id IS NULL AND p.asrama_jenis IN (
              SELECT k.jenis_kelamin FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id WHERE uk.user_id = ?
         ))
         OR (p.penerima_id IS NULL AND p.asrama_jenis = ?))
        AND NOT EXISTS (SELECT 1 FROM pesan_dibaca pd WHERE pd.pesan_id = p.id AND pd.user_id = ?))`
  ).bind(user.sub, user.sub, user.asrama_jenis || '', user.sub).first<{ count: number }>()

  return c.json({ data: { unread: row?.count || 0 } })
})

// GET /api/pesan/sent — daftar pesan terkirim (kyai & admin)
pesan.get('/sent', requireAnyRole('kyai', 'admin'), async (c) => {
  const user = c.get('user')
  const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200)
  const offset = (page - 1) * limit

  const rows = await c.env.DB.prepare(
    `SELECT p.* FROM pesan p WHERE p.pengirim_id = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).bind(user.sub, limit, offset).all()

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM pesan WHERE pengirim_id = ?'
  ).bind(user.sub).first<{ count: number }>()

  return c.json({
    data: rows.results || [],
    pagination: {
      page, limit,
      total: total?.count || 0,
      total_pages: Math.ceil((total?.count || 0) / limit)
    }
  })
})

// GET /api/pesan/:id — detail pesan (auto mark-as-read untuk penerima)
pesan.get('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const row = await c.env.DB.prepare(
    `SELECT p.*, u.nama_lengkap as pengirim_nama
     FROM pesan p LEFT JOIN users u ON p.pengirim_id = u.id WHERE p.id = ?`
  ).bind(id).first<{ pengirim_id: string; penerima_id: string | null; asrama_jenis: string | null }>()

  if (!row) {
    return c.json({ error: 'Not Found', code: 'PESAN_NOT_FOUND', message: 'Pesan tidak ditemukan.' } as ApiError, 404)
  }

  const isSender = row.pengirim_id === user.sub
  const isDirectRecipient = row.penerima_id === user.sub
  // Broadcast: penerima_id IS NULL. Global broadcast (asrama_jenis NULL) → semua user.
  // Asrama broadcast → cek apakah user punya kamar di asrama itu (ustadz) atau kepala_asrama asrama itu.
  let isBroadcastRecipient = false
  if (row.penerima_id === null) {
    if (row.asrama_jenis === null) {
      isBroadcastRecipient = true
    } else {
      // kepala_asrama asrama itu, atau ustadz yang pegang kamar asrama itu
      if (user.role === 'kyai') {
        isBroadcastRecipient = false
      } else if (user.role === 'kepala_asrama') {
        isBroadcastRecipient = user.asrama_jenis === row.asrama_jenis
      } else {
        const kamarMatch = await c.env.DB.prepare(
          `SELECT 1 FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id
           WHERE uk.user_id = ? AND k.jenis_kelamin = ? LIMIT 1`
        ).bind(user.sub, row.asrama_jenis).first()
        isBroadcastRecipient = !!kamarMatch
      }
    }
  }

  if (!isSender && !isDirectRecipient && !isBroadcastRecipient) {
    return c.json({ error: 'Forbidden', code: 'PESAN_NOT_ACCESSIBLE', message: 'Anda tidak memiliki akses ke pesan ini.' } as ApiError, 403)
  }

  // Auto mark read: insert pesan_dibaca (idempotent via PK) — hanya untuk penerima/broadcast audience
  if (isDirectRecipient || isBroadcastRecipient) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO pesan_dibaca (pesan_id, user_id) VALUES (?, ?)`
    ).bind(id, user.sub).run()
  }

  const result = await c.env.DB.prepare('SELECT * FROM pesan WHERE id = ?').bind(id).first()
  return c.json({ data: { ...result, pengirim_nama: (row as any).pengirim_nama } })
})

// GET /api/pesan/recipients/list — daftar ustadz untuk dropdown pilihan penerima (kyai & admin)
pesan.get('/recipients/list', requireAnyRole('kyai', 'admin'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.nama_lengkap,
       (SELECT GROUP_CONCAT(k.jenis_kelamin, '') FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id WHERE uk.user_id = u.id) as asrama
     FROM users u
     WHERE u.role = 'ustadz' AND u.status = 'approved'
     ORDER BY u.nama_lengkap ASC`
  ).all<{ id: string; nama_lengkap: string; asrama: string | null }>()

  return c.json({ data: rows.results || [] })
})

export { pesan as pesanRoutes }
