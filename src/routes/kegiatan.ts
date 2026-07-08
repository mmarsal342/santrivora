import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireCanMutate } from '../middleware/auth'
import { resolveKamarScope, canAccessKamar } from '../lib/scope'
import type { ApiError, Env, UserPayload } from '../types'

const kegiatan = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

kegiatan.use('*', authMiddleware)

const createSchema = z.object({
  nama: z.string().min(1, 'Nama kegiatan harus diisi').max(200),
  jenis: z.string().max(50).optional(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  kelas_id: z.string().uuid().optional(),
  kamar_id: z.string().uuid().optional()
})

const updateSchema = z.object({
  nama: z.string().min(1).max(200).optional(),
  jenis: z.string().max(50).nullable().optional(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kelas_id: z.string().uuid().nullable().optional(),
  kamar_id: z.string().uuid().nullable().optional(),
  is_active: z.number().int().optional()
})

function canManage(user: UserPayload, kegiatanRow: { created_by: string }) {
  return user.role === 'admin' || user.sub === kegiatanRow.created_by
}

// Bikin instance kegiatan hari itu dari tiap jadwal_kegiatan aktif yang belum
// punya instance-nya — jadi admin/wali kamar gak perlu bikin ulang tiap hari.
// created_by ikut punya template (bukan siapa pun yang lagi request), biar hak
// edit/hapus (canManage) gak jatuh secara acak ke user pertama yang buka halaman.
// INSERT OR IGNORE: aman kalau dua request nge-materialize tanggal yang sama bersamaan.
// Cuma materialize hari ini/ke depan — jangan "ciptakan ulang" histori tanggal
// yang udah lewat sebelum template ini pernah ada.
async function materializeJadwalKegiatan(db: D1Database, tanggal: string) {
  const today = new Date().toISOString().slice(0, 10)
  if (tanggal < today) return

  const templates = await db.prepare(
    `SELECT j.id, j.nama, j.jenis, j.kelas_id, j.kamar_id, j.created_by
     FROM jadwal_kegiatan j
     WHERE j.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM kegiatan g WHERE g.jadwal_kegiatan_id = j.id AND g.tanggal = ?)`
  ).bind(tanggal).all<{ id: string; nama: string; jenis: string | null; kelas_id: string | null; kamar_id: string | null; created_by: string }>()

  const rows = templates.results || []
  if (rows.length === 0) return

  const statements = rows.map((t) =>
    db.prepare(
      `INSERT OR IGNORE INTO kegiatan (id, nama, jenis, tanggal, kelas_id, kamar_id, jadwal_kegiatan_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), t.nama, t.jenis, tanggal, t.kelas_id, t.kamar_id, t.id, t.created_by)
  )
  await db.batch(statements)
}

// GET /api/kegiatan — filter by tanggal/kelas_id/kamar_id, scoped by role
kegiatan.get('/', async (c) => {
  const user = c.get('user')
  const { tanggal, kelas_id, kamar_id } = c.req.query()

  if (tanggal) {
    await materializeJadwalKegiatan(c.env.DB, tanggal)
  }

  const conditions: string[] = ['g.is_active = 1']
  const params: unknown[] = []

  if (tanggal) {
    conditions.push('g.tanggal = ?')
    params.push(tanggal)
  }
  if (kelas_id) {
    conditions.push('g.kelas_id = ?')
    params.push(kelas_id)
  }
  if (kamar_id) {
    conditions.push('g.kamar_id = ?')
    params.push(kamar_id)
  }

  // Scope: ustadz (kelas/kamar) & kepala_asrama (kamar asramanya). kyai/admin = global.
  const scopedKamarIds = await resolveKamarScope(c.env, user)
  if (scopedKamarIds !== null) {
    const scopeParts = ['(g.kelas_id IS NULL AND g.kamar_id IS NULL)']
    if (user.role === 'ustadz' && user.kelas_ids.length > 0) {
      scopeParts.push(`g.kelas_id IN (${user.kelas_ids.map(() => '?').join(',')})`)
      params.push(...user.kelas_ids)
    }
    if (scopedKamarIds.length > 0) {
      scopeParts.push(`g.kamar_id IN (${scopedKamarIds.map(() => '?').join(',')})`)
      params.push(...scopedKamarIds)
    }
    conditions.push(`(${scopeParts.join(' OR ')})`)
  }

  const query = `
    SELECT g.*, k.nama as kelas_nama, r.nama as kamar_nama
    FROM kegiatan g
    LEFT JOIN kelas k ON g.kelas_id = k.id
    LEFT JOIN kamar r ON g.kamar_id = r.id
    LEFT JOIN jadwal_kegiatan j ON g.jadwal_kegiatan_id = j.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY g.tanggal DESC, COALESCE(j.urutan, 999) ASC, g.nama ASC
  `
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ data: result.results || [] })
})

// GET /api/kegiatan/:id
kegiatan.get('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const result = await c.env.DB.prepare(`
    SELECT g.*, k.nama as kelas_nama, r.nama as kamar_nama
    FROM kegiatan g
    LEFT JOIN kelas k ON g.kelas_id = k.id
    LEFT JOIN kamar r ON g.kamar_id = r.id
    WHERE g.id = ?
  `).bind(id).first<{ kelas_id: string | null; kamar_id: string | null }>()

  if (!result) {
    return c.json({
      error: 'Not Found',
      code: 'KEGIATAN_NOT_FOUND',
      message: 'Kegiatan tidak ditemukan.'
    } as ApiError, 404)
  }

  if (user.role === 'ustadz') {
    const inKelas = result.kelas_id && user.kelas_ids.includes(result.kelas_id)
    const inKamar = result.kamar_id && user.kamar_ids.includes(result.kamar_id)
    const isGeneral = !result.kelas_id && !result.kamar_id
    if (!inKelas && !inKamar && !isGeneral) {
      return c.json({
        error: 'Forbidden',
        code: 'KEGIATAN_NOT_ACCESSIBLE',
        message: 'Anda tidak memiliki akses ke kegiatan ini.'
      } as ApiError, 403)
    }
  } else if (user.role === 'kepala_asrama') {
    const isGeneral = !result.kelas_id && !result.kamar_id
    const inAsrama = await canAccessKamar(c.env, user, result.kamar_id)
    if (!isGeneral && !inAsrama) {
      return c.json({
        error: 'Forbidden',
        code: 'KEGIATAN_NOT_ACCESSIBLE',
        message: 'Kegiatan ini di luar lingkup asrama Anda.'
      } as ApiError, 403)
    }
  }

  return c.json({ data: result })
})

// POST /api/kegiatan
kegiatan.post('/', requireCanMutate(), zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  if (user.role === 'ustadz') {
    if (data.kelas_id && !user.kelas_ids.includes(data.kelas_id)) {
      return c.json({
        error: 'Forbidden',
        code: 'KELAS_NOT_ASSIGNED',
        message: 'Anda tidak dapat membuat kegiatan untuk kelas yang tidak Anda ajar.'
      } as ApiError, 403)
    }
    if (data.kamar_id && !user.kamar_ids.includes(data.kamar_id)) {
      return c.json({
        error: 'Forbidden',
        code: 'KAMAR_NOT_ASSIGNED',
        message: 'Anda bukan wali kamar tersebut.'
      } as ApiError, 403)
    }
  } else if (user.role === 'kepala_asrama') {
    if (data.kamar_id && !(await canAccessKamar(c.env, user, data.kamar_id))) {
      return c.json({
        error: 'Forbidden',
        code: 'KAMAR_NOT_IN_ASRAMA',
        message: 'Kamar ini di luar lingkup asrama Anda.'
      } as ApiError, 403)
    }
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO kegiatan (id, nama, jenis, tanggal, kelas_id, kamar_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, data.nama, data.jenis || null, data.tanggal,
    data.kelas_id || null, data.kamar_id || null, user.sub
  ).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'kegiatan.create', 'kegiatan', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM kegiatan WHERE id = ?').bind(id).first()
  return c.json({ message: 'Kegiatan berhasil dibuat.', data: result }, 201)
})

// PUT /api/kegiatan/:id — admin, pembuat kegiatan, atau kepala_asrama (asramanya)
kegiatan.put('/:id', requireCanMutate(), zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kegiatan WHERE id = ?').bind(id).first<{ created_by: string; kamar_id: string | null }>()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KEGIATAN_NOT_FOUND',
      message: 'Kegiatan tidak ditemukan.'
    } as ApiError, 404)
  }

  const mayManage = canManage(user, existing)
    || (user.role === 'kepala_asrama' && (await canAccessKamar(c.env, user, existing.kamar_id)))
  if (!mayManage) {
    return c.json({
      error: 'Forbidden',
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Anda tidak dapat mengubah kegiatan ini.'
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

  updates.push("updated_at = datetime('now')")
  params.push(id)

  await c.env.DB.prepare(`UPDATE kegiatan SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'kegiatan.update', 'kegiatan', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM kegiatan WHERE id = ?').bind(id).first()
  return c.json({ message: 'Kegiatan berhasil diperbarui.', data: result })
})

// DELETE /api/kegiatan/:id — soft delete, admin, pembuat, atau kepala_asrama (asramanya)
kegiatan.delete('/:id', requireCanMutate(), async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM kegiatan WHERE id = ? AND is_active = 1').bind(id).first<{ created_by: string; kamar_id: string | null }>()
  if (!existing) {
    return c.json({
      error: 'Not Found',
      code: 'KEGIATAN_NOT_FOUND',
      message: 'Kegiatan tidak ditemukan atau sudah tidak aktif.'
    } as ApiError, 404)
  }

  const mayManage = canManage(user, existing)
    || (user.role === 'kepala_asrama' && (await canAccessKamar(c.env, user, existing.kamar_id)))
  if (!mayManage) {
    return c.json({
      error: 'Forbidden',
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'Anda tidak dapat menghapus kegiatan ini.'
    } as ApiError, 403)
  }

  await c.env.DB.prepare(
    "UPDATE kegiatan SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'kegiatan.delete', 'kegiatan', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Kegiatan berhasil dihapus.' })
})

export { kegiatan as kegiatanRoutes }
