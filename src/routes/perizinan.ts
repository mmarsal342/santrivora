import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, requireCanMutate, requireAnyRole } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const perizinan = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

perizinan.use('*', authMiddleware)

const ajukanSchema = z.object({
  santri_id: z.string().uuid(),
  tanggal_keluar: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD'),
  perkiraan_kembali: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  alasan: z.string().min(1, 'Alasan wajib diisi').max(500)
}).refine((data) => !data.perkiraan_kembali || data.perkiraan_kembali >= data.tanggal_keluar, {
  message: 'Perkiraan kembali tidak boleh sebelum tanggal keluar.',
  path: ['perkiraan_kembali']
})

const updateSchema = z.object({
  tanggal_keluar: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  perkiraan_kembali: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  alasan: z.string().min(1).max(500).optional()
})

const keputusanSchema = z.object({
  catatan_keputusan: z.string().max(500).optional()
})

const tolakSchema = z.object({
  catatan_keputusan: z.string().min(1, 'Alasan penolakan wajib diisi').max(500)
})

const kembaliSchema = z.object({
  tanggal_kembali_aktual: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

// Akses baca/ajukan: sama seperti catatan santri lain — scope kamar/kelas
// untuk ustadz, scope asrama untuk kepala_asrama, global untuk admin/kyai.
async function assertAccess(
  env: Env, user: UserPayload, santriId: string
): Promise<{ ok: true; kamarId: string | null } | { ok: false; reason: string; status: number }> {
  const santri = await env.DB.prepare(
    'SELECT kamar_id, kelas_id FROM santri WHERE id = ?'
  ).bind(santriId).first<{ kamar_id: string | null; kelas_id: string | null }>()

  if (!santri) return { ok: false, reason: 'SANTRI_NOT_FOUND', status: 404 }

  if (user.role === 'admin' || user.role === 'kyai') return { ok: true, kamarId: santri.kamar_id }

  if (user.role === 'kepala_asrama') {
    if (santri.kamar_id && user.asrama_jenis) {
      const k = await env.DB.prepare('SELECT jenis_kelamin FROM kamar WHERE id = ? AND is_active = 1').bind(santri.kamar_id).first<{ jenis_kelamin: string }>()
      if (k && k.jenis_kelamin === user.asrama_jenis) return { ok: true, kamarId: santri.kamar_id }
    }
    return { ok: false, reason: 'NOT_ASSIGNED', status: 403 }
  }

  if (santri.kamar_id && user.kamar_ids.includes(santri.kamar_id)) return { ok: true, kamarId: santri.kamar_id }
  if (santri.kelas_id && user.kelas_ids.includes(santri.kelas_id)) return { ok: true, kamarId: santri.kamar_id }

  return { ok: false, reason: 'NOT_ASSIGNED', status: 403 }
}

// Akses approve/tolak: LEBIH SEMPIT dari assertAccess — cuma admin (global)
// dan kepala_asrama (asramanya sendiri). Ustadz wali kamar/kelas boleh
// mengajukan, tapi bukan yang menyetujui — itu tujuan alur approval berjenjang.
async function assertApprovalAccess(
  env: Env, user: UserPayload, kamarId: string | null
): Promise<boolean> {
  if (user.role === 'admin') return true
  if (user.role === 'kepala_asrama') {
    if (!kamarId || !user.asrama_jenis) return false
    const k = await env.DB.prepare('SELECT jenis_kelamin FROM kamar WHERE id = ? AND is_active = 1').bind(kamarId).first<{ jenis_kelamin: string }>()
    return !!k && k.jenis_kelamin === user.asrama_jenis
  }
  return false
}

function errorResponse(reason: string, status: number): Response {
  const messages: Record<string, string> = {
    SANTRI_NOT_FOUND: 'Santri tidak ditemukan.',
    NOT_ASSIGNED: 'Anda tidak memiliki akses ke santri ini.',
    PERIZINAN_NOT_FOUND: 'Perizinan tidak ditemukan.',
    NOT_DIAJUKAN: 'Perizinan ini sudah diproses, tidak bisa diubah/dibatalkan lagi.',
    NOT_DISETUJUI: 'Perizinan ini belum disetujui, belum bisa ditandai kembali.',
    APPROVAL_FORBIDDEN: 'Anda tidak berwenang menyetujui/menolak perizinan ini.',
    ALREADY_PROCESSED: 'Perizinan ini sudah keburu diproses pihak lain. Muat ulang data terbaru.',
    TANGGAL_KEMBALI_INVALID: 'Tanggal kembali tidak boleh sebelum tanggal keluar.'
  }
  return Response.json({
    error: status === 404 ? 'Not Found' : status === 409 ? 'Conflict' : 'Forbidden',
    code: reason,
    message: messages[reason] || 'Akses ditolak.'
  } as ApiError, { status })
}

// GET /api/perizinan?santri_id=...&status=...
perizinan.get('/', async (c) => {
  const user = c.get('user')
  const santriId = c.req.query('santri_id')
  const status = c.req.query('status')

  if (santriId) {
    const access = await assertAccess(c.env, user, santriId)
    if (!access.ok) return errorResponse(access.reason, access.status)

    const params: unknown[] = [santriId]
    let query = `SELECT p.*, s.nama_lengkap as santri_nama, u1.nama_lengkap as diajukan_oleh_nama, u2.nama_lengkap as disetujui_oleh_nama
                 FROM perizinan_pulang p
                 JOIN santri s ON p.santri_id = s.id
                 LEFT JOIN users u1 ON p.diajukan_oleh = u1.id
                 LEFT JOIN users u2 ON p.disetujui_oleh = u2.id
                 WHERE p.santri_id = ? AND p.is_deleted = 0`
    if (status) { query += ' AND p.status = ?'; params.push(status) }
    query += ' ORDER BY p.tanggal_keluar DESC, p.created_at DESC LIMIT 200'

    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ data: result.results || [] })
  }

  // Tanpa santri_id: list scoped by role (mirror pola list santri di santri.ts)
  const whereParts: string[] = ['p.is_deleted = 0']
  const params: unknown[] = []
  if (status) { whereParts.push('p.status = ?'); params.push(status) }

  if (user.role === 'ustadz') {
    if (user.kamar_ids.length === 0 && user.kelas_ids.length === 0) {
      return c.json({ data: [] })
    }
    const scopeParts: string[] = []
    if (user.kamar_ids.length > 0) {
      scopeParts.push(`s.kamar_id IN (${user.kamar_ids.map(() => '?').join(',')})`)
      params.push(...user.kamar_ids)
    }
    if (user.kelas_ids.length > 0) {
      scopeParts.push(`s.kelas_id IN (${user.kelas_ids.map(() => '?').join(',')})`)
      params.push(...user.kelas_ids)
    }
    whereParts.push(`(${scopeParts.join(' OR ')})`)
  } else if (user.role === 'kepala_asrama') {
    whereParts.push(`s.kamar_id IN (SELECT id FROM kamar WHERE jenis_kelamin = ? AND is_active = 1)`)
    params.push(user.asrama_jenis || '')
  }

  const where = whereParts.length > 0 ? ' WHERE ' + whereParts.join(' AND ') : ''
  const result = await c.env.DB.prepare(
    `SELECT p.*, s.nama_lengkap as santri_nama, u1.nama_lengkap as diajukan_oleh_nama, u2.nama_lengkap as disetujui_oleh_nama
     FROM perizinan_pulang p
     JOIN santri s ON p.santri_id = s.id
     LEFT JOIN users u1 ON p.diajukan_oleh = u1.id
     LEFT JOIN users u2 ON p.disetujui_oleh = u2.id
     ${where}
     ORDER BY p.tanggal_keluar DESC, p.created_at DESC
     LIMIT 200`
  ).bind(...params).all()

  return c.json({ data: result.results || [] })
})

// POST /api/perizinan — ajukan izin pulang
perizinan.post('/', requireCanMutate(), zValidator('json', ajukanSchema), async (c) => {
  const data = c.req.valid('json')
  const user = c.get('user')

  const access = await assertAccess(c.env, user, data.santri_id)
  if (!access.ok) return errorResponse(access.reason, access.status)

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO perizinan_pulang (id, santri_id, tanggal_keluar, perkiraan_kembali, alasan, diajukan_oleh)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, data.santri_id, data.tanggal_keluar, data.perkiraan_kembali || null, data.alasan, user.sub).run()

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'perizinan.ajukan', 'perizinan_pulang', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM perizinan_pulang WHERE id = ?').bind(id).first()
  return c.json({ message: 'Perizinan berhasil diajukan.', data: result }, 201)
})

// PUT /api/perizinan/:id — edit selama masih 'diajukan'
perizinan.put('/:id', requireCanMutate(), zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM perizinan_pulang WHERE id = ? AND is_deleted = 0').bind(id)
    .first<{ santri_id: string; status: string; tanggal_keluar: string; perkiraan_kembali: string | null }>()
  if (!existing) return errorResponse('PERIZINAN_NOT_FOUND', 404)

  const access = await assertAccess(c.env, user, existing.santri_id)
  if (!access.ok) return errorResponse(access.reason, access.status)

  if (existing.status !== 'diajukan') return errorResponse('NOT_DIAJUKAN', 400)

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

  const mergedTanggalKeluar = data.tanggal_keluar ?? existing.tanggal_keluar
  const mergedPerkiraanKembali = data.perkiraan_kembali !== undefined ? data.perkiraan_kembali : existing.perkiraan_kembali
  if (mergedPerkiraanKembali && mergedPerkiraanKembali < mergedTanggalKeluar) {
    return errorResponse('TANGGAL_KEMBALI_INVALID', 400)
  }

  updates.push('version = version + 1')
  updates.push("updated_at = datetime('now')")
  params.push(id)

  // Guard WHERE status = 'diajukan' di UPDATE-nya sendiri (bukan cuma di cek di atas) —
  // supaya dua request konkuren (mis. edit vs approve yang jalan nyaris bersamaan)
  // tidak bisa dua-duanya lolos berdasarkan SELECT yang sama-sama masih baca status lama.
  const stmt = await c.env.DB.prepare(
    `UPDATE perizinan_pulang SET ${updates.join(', ')} WHERE id = ? AND status = 'diajukan'`
  ).bind(...params).run()
  if (stmt.meta.changes === 0) return errorResponse('ALREADY_PROCESSED', 409)

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES (?, ?, 'perizinan.update', 'perizinan_pulang', ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify(existing), JSON.stringify(data)).run()

  const result = await c.env.DB.prepare('SELECT * FROM perizinan_pulang WHERE id = ?').bind(id).first()
  return c.json({ message: 'Perizinan berhasil diperbarui.', data: result })
})

// DELETE /api/perizinan/:id — batalkan, cuma selama masih 'diajukan'
perizinan.delete('/:id', requireCanMutate(), async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM perizinan_pulang WHERE id = ? AND is_deleted = 0').bind(id).first<{ santri_id: string; status: string }>()
  if (!existing) return errorResponse('PERIZINAN_NOT_FOUND', 404)

  const access = await assertAccess(c.env, user, existing.santri_id)
  if (!access.ok) return errorResponse(access.reason, access.status)

  if (existing.status !== 'diajukan') return errorResponse('NOT_DIAJUKAN', 400)

  // Soft-delete (is_deleted=1), bukan DELETE FROM — dibutuhkan supaya
  // pembatalan ke-propagate sebagai tombstone ke sync pull (lihat migrasi 016).
  const stmt = await c.env.DB.prepare(
    "UPDATE perizinan_pulang SET is_deleted = 1, version = version + 1, updated_at = datetime('now') WHERE id = ? AND status = 'diajukan'"
  ).bind(id).run()
  if (stmt.meta.changes === 0) return errorResponse('ALREADY_PROCESSED', 409)

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'perizinan.batalkan', 'perizinan_pulang', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  return c.json({ message: 'Perizinan berhasil dibatalkan.' })
})

// POST /api/perizinan/:id/approve — admin & kepala_asrama (asramanya sendiri)
perizinan.post('/:id/approve', requireAnyRole('admin', 'kepala_asrama'), zValidator('json', keputusanSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(
    `SELECT p.*, s.kamar_id FROM perizinan_pulang p JOIN santri s ON p.santri_id = s.id WHERE p.id = ? AND p.is_deleted = 0`
  ).bind(id).first<{ status: string; kamar_id: string | null }>()
  if (!existing) return errorResponse('PERIZINAN_NOT_FOUND', 404)

  if (!(await assertApprovalAccess(c.env, user, existing.kamar_id))) return errorResponse('APPROVAL_FORBIDDEN', 403)
  if (existing.status !== 'diajukan') return errorResponse('NOT_DIAJUKAN', 400)

  const stmt = await c.env.DB.prepare(
    `UPDATE perizinan_pulang SET status = 'disetujui', disetujui_oleh = ?, catatan_keputusan = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND status = 'diajukan'`
  ).bind(user.sub, data.catatan_keputusan || null, id).run()
  if (stmt.meta.changes === 0) return errorResponse('ALREADY_PROCESSED', 409)

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'perizinan.approve', 'perizinan_pulang', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  const result = await c.env.DB.prepare('SELECT * FROM perizinan_pulang WHERE id = ?').bind(id).first()
  return c.json({ message: 'Perizinan disetujui.', data: result })
})

// POST /api/perizinan/:id/tolak — admin & kepala_asrama (asramanya sendiri)
perizinan.post('/:id/tolak', requireAnyRole('admin', 'kepala_asrama'), zValidator('json', tolakSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare(
    `SELECT p.*, s.kamar_id FROM perizinan_pulang p JOIN santri s ON p.santri_id = s.id WHERE p.id = ? AND p.is_deleted = 0`
  ).bind(id).first<{ status: string; kamar_id: string | null }>()
  if (!existing) return errorResponse('PERIZINAN_NOT_FOUND', 404)

  if (!(await assertApprovalAccess(c.env, user, existing.kamar_id))) return errorResponse('APPROVAL_FORBIDDEN', 403)
  if (existing.status !== 'diajukan') return errorResponse('NOT_DIAJUKAN', 400)

  const stmt = await c.env.DB.prepare(
    `UPDATE perizinan_pulang SET status = 'ditolak', disetujui_oleh = ?, catatan_keputusan = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND status = 'diajukan'`
  ).bind(user.sub, data.catatan_keputusan, id).run()
  if (stmt.meta.changes === 0) return errorResponse('ALREADY_PROCESSED', 409)

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value)
     VALUES (?, ?, 'perizinan.tolak', 'perizinan_pulang', ?, ?)`
  ).bind(crypto.randomUUID(), user.sub, id, JSON.stringify({ catatan_keputusan: data.catatan_keputusan })).run()

  const result = await c.env.DB.prepare('SELECT * FROM perizinan_pulang WHERE id = ?').bind(id).first()
  return c.json({ message: 'Perizinan ditolak.', data: result })
})

// POST /api/perizinan/:id/kembali — tandai santri sudah kembali (butuh status 'disetujui')
perizinan.post('/:id/kembali', requireCanMutate(), zValidator('json', kembaliSchema), async (c) => {
  const id = c.req.param('id')
  const data = c.req.valid('json')
  const user = c.get('user')

  const existing = await c.env.DB.prepare('SELECT * FROM perizinan_pulang WHERE id = ? AND is_deleted = 0').bind(id)
    .first<{ santri_id: string; status: string; tanggal_keluar: string; alasan: string }>()
  if (!existing) return errorResponse('PERIZINAN_NOT_FOUND', 404)

  const access = await assertAccess(c.env, user, existing.santri_id)
  if (!access.ok) return errorResponse(access.reason, access.status)

  if (existing.status !== 'disetujui') return errorResponse('NOT_DISETUJUI', 400)

  const tanggalKembaliAktual = data.tanggal_kembali_aktual || new Date().toISOString().slice(0, 10)
  if (tanggalKembaliAktual < existing.tanggal_keluar) return errorResponse('TANGGAL_KEMBALI_INVALID', 400)

  const stmt = await c.env.DB.prepare(
    `UPDATE perizinan_pulang SET status = 'selesai', tanggal_kembali_aktual = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND status = 'disetujui'`
  ).bind(tanggalKembaliAktual, id).run()
  if (stmt.meta.changes === 0) return errorResponse('ALREADY_PROCESSED', 409)

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id)
     VALUES (?, ?, 'perizinan.kembali', 'perizinan_pulang', ?)`
  ).bind(crypto.randomUUID(), user.sub, id).run()

  // Catatkan juga ke catatan_perkembangan santri, supaya izin pulang yang sudah
  // selesai (pergi -> kembali) ikut muncul di timeline perkembangan santri —
  // bukan cuma tersimpan di halaman Perizinan Pulang yang terpisah.
  await c.env.DB.prepare(
    `INSERT INTO catatan_perkembangan (id, santri_id, tanggal, kategori, judul, catatan, dicatat_oleh)
     VALUES (?, ?, ?, 'Keluarga', 'Izin Pulang', ?, ?)`
  ).bind(
    crypto.randomUUID(),
    existing.santri_id,
    existing.tanggal_keluar,
    `${existing.alasan} (keluar ${existing.tanggal_keluar}, kembali ${tanggalKembaliAktual})`,
    user.sub
  ).run()

  const result = await c.env.DB.prepare('SELECT * FROM perizinan_pulang WHERE id = ?').bind(id).first()
  return c.json({ message: 'Santri sudah ditandai kembali.', data: result })
})

export { perizinan as perizinanRoutes }
