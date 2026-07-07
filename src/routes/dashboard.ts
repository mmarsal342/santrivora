import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import type { ApiError, Env, UserPayload } from '../types'

const dashboard = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

dashboard.use('*', authMiddleware)

// GET /api/dashboard/summary
dashboard.get('/summary', requireRole('admin'), async (c) => {
  const [totalSantri, totalKamar, totalPelanggaran, totalPrestasi, perKategori, perKamar, topPelanggar] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM santri WHERE status = 'aktif'"
    ).first<{ count: number }>(),

    c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM kamar WHERE is_active = 1'
    ).first<{ count: number }>(),

    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM catatan_disiplin WHERE tipe = 'pelanggaran' AND is_deleted = 0 AND date(tanggal_kejadian) >= date('now', '-30 days')"
    ).first<{ count: number }>(),

    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM catatan_disiplin WHERE tipe = 'prestasi' AND is_deleted = 0 AND date(tanggal_kejadian) >= date('now', '-30 days')"
    ).first<{ count: number }>(),

    // Violations per kategori
    c.env.DB.prepare(`
      SELECT kp.id, kp.nama, kp.urutan_keparahan, COUNT(cd.id) as total
      FROM kategori_pelanggaran kp
      LEFT JOIN catatan_disiplin cd ON cd.kategori_id = kp.id
        AND cd.tipe = 'pelanggaran' AND cd.is_deleted = 0
        AND date(cd.tanggal_kejadian) >= date('now', '-30 days')
      WHERE kp.is_active = 1
      GROUP BY kp.id
      ORDER BY total DESC
    `).all(),

    // Per kamar breakdown
    c.env.DB.prepare(`
      SELECT km.id, km.nama,
        COUNT(CASE WHEN cd.tipe = 'pelanggaran' THEN 1 END) as pelanggaran,
        COUNT(CASE WHEN cd.tipe = 'prestasi' THEN 1 END) as prestasi,
        COUNT(DISTINCT s.id) as jumlah_santri
      FROM kamar km
      LEFT JOIN santri s ON s.kamar_id = km.id AND s.status = 'aktif'
      LEFT JOIN catatan_disiplin cd ON cd.santri_id = s.id AND cd.is_deleted = 0
        AND date(cd.tanggal_kejadian) >= date('now', '-30 days')
      WHERE km.is_active = 1
      GROUP BY km.id
      ORDER BY km.nama
    `).all(),

    // Top santri with most violations
    c.env.DB.prepare(`
      SELECT s.id, s.nama_lengkap, km.nama as kamar_nama, COUNT(cd.id) as total
      FROM santri s
      LEFT JOIN kamar km ON s.kamar_id = km.id
      INNER JOIN catatan_disiplin cd ON cd.santri_id = s.id
        AND cd.tipe = 'pelanggaran' AND cd.is_deleted = 0
        AND date(cd.tanggal_kejadian) >= date('now', '-30 days')
      WHERE s.status = 'aktif'
      GROUP BY s.id
      ORDER BY total DESC
      LIMIT 10
    `).all()
  ])

  return c.json({
    data: {
      totals: {
        santri: totalSantri?.count || 0,
        kamar: totalKamar?.count || 0,
        pelanggaran_30hari: totalPelanggaran?.count || 0,
        prestasi_30hari: totalPrestasi?.count || 0
      },
      per_kategori: perKategori.results,
      per_kamar: perKamar.results,
      top_pelanggar: topPelanggar.results
    }
  })
})

// GET /api/dashboard/trends?period=7d
dashboard.get('/trends', requireRole('admin'), async (c) => {
  const period = c.req.query('period') || '7d'
  let days = 7
  if (period === '30d') days = 30
  if (period === '90d') days = 90

  const trends = await c.env.DB.prepare(`
    SELECT
      date(tanggal_kejadian) as date,
      tipe,
      COUNT(*) as total
    FROM catatan_disiplin
    WHERE is_deleted = 0
      AND date(tanggal_kejadian) >= date('now', '-${days} days')
    GROUP BY date(tanggal_kejadian), tipe
    ORDER BY date ASC
  `).all()

  return c.json({
    data: {
      period,
      trends: trends.results
    }
  })
})

function defaultDateRange(c: { req: { query: (k: string) => string | undefined } }) {
  const now = new Date()
  const sampaiDefault = now.toISOString().slice(0, 10)
  const dariDefault = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const dari = c.req.query('dari') || dariDefault
  const sampai = c.req.query('sampai') || sampaiDefault
  return { dari, sampai }
}

// Rekap absensi + disiplin + flag "butuh diperhatikan" untuk sekumpulan kamar.
// Absensi dihitung dari sisi KAMAR (bukan kelas) — itu domain operasional
// harian pondok. Disiplin (pelanggaran/prestasi) tetap ikut ditampilkan
// walau pencatatannya tetap wewenang wali kelas, karena wali kamar tetap
// perlu gambaran utuh soal santrinya sendiri.
async function computeKamarStats(env: Env, kamarIds: string[], dari: string, sampai: string) {
  if (kamarIds.length === 0) {
    return {
      jumlah_santri: 0,
      absensi: { hadir: 0, sakit: 0, izin: 0, alpa: 0, tingkat_kehadiran_persen: 0 },
      disiplin: { pelanggaran: 0, prestasi: 0 },
      santri_butuh_perhatian: [] as Array<{ id: string; nama_lengkap: string; alasan: string }>
    }
  }

  const ph = kamarIds.map(() => '?').join(',')

  const santriCount = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM santri WHERE kamar_id IN (${ph}) AND status = 'aktif'`
  ).bind(...kamarIds).first<{ count: number }>()

  const absensiRows = await env.DB.prepare(`
    SELECT a.status, COUNT(*) as jumlah
    FROM absensi a
    INNER JOIN santri s ON a.santri_id = s.id
    WHERE s.kamar_id IN (${ph}) AND a.tanggal BETWEEN ? AND ?
    GROUP BY a.status
  `).bind(...kamarIds, dari, sampai).all<{ status: string; jumlah: number }>()

  const absensi = { hadir: 0, sakit: 0, izin: 0, alpa: 0 } as Record<string, number>
  for (const row of absensiRows.results || []) {
    if (row.status in absensi) absensi[row.status] = row.jumlah
  }
  const totalAbsensi = absensi.hadir + absensi.sakit + absensi.izin + absensi.alpa
  const tingkatKehadiran = totalAbsensi > 0 ? Math.round((absensi.hadir / totalAbsensi) * 1000) / 10 : 0

  const disiplinRows = await env.DB.prepare(`
    SELECT cd.tipe, COUNT(*) as jumlah
    FROM catatan_disiplin cd
    INNER JOIN santri s ON cd.santri_id = s.id
    WHERE s.kamar_id IN (${ph}) AND cd.is_deleted = 0
      AND date(cd.tanggal_kejadian) BETWEEN ? AND ?
    GROUP BY cd.tipe
  `).bind(...kamarIds, dari, sampai).all<{ tipe: string; jumlah: number }>()

  const disiplin = { pelanggaran: 0, prestasi: 0 } as Record<string, number>
  for (const row of disiplinRows.results || []) {
    if (row.tipe in disiplin) disiplin[row.tipe] = row.jumlah
  }

  // Flag: santri alpa 3x atau lebih dalam periode ini
  const alpaRows = await env.DB.prepare(`
    SELECT s.id, s.nama_lengkap, COUNT(*) as jumlah_alpa
    FROM absensi a
    INNER JOIN santri s ON a.santri_id = s.id
    WHERE s.kamar_id IN (${ph}) AND a.status = 'alpa' AND a.tanggal BETWEEN ? AND ?
    GROUP BY s.id
    HAVING COUNT(*) >= 3
    ORDER BY jumlah_alpa DESC
  `).bind(...kamarIds, dari, sampai).all<{ id: string; nama_lengkap: string; jumlah_alpa: number }>()

  const santriButuhPerhatian = (alpaRows.results || []).map((r) => ({
    id: r.id,
    nama_lengkap: r.nama_lengkap,
    alasan: `Alpa ${r.jumlah_alpa}x dalam periode ini`
  }))

  return {
    jumlah_santri: santriCount?.count || 0,
    absensi: { ...absensi, tingkat_kehadiran_persen: tingkatKehadiran } as {
      hadir: number; sakit: number; izin: number; alpa: number; tingkat_kehadiran_persen: number
    },
    disiplin: disiplin as { pelanggaran: number; prestasi: number },
    santri_butuh_perhatian: santriButuhPerhatian
  }
}

// GET /api/dashboard/per-wali-kamar?dari=&sampai= — ringkasan tiap wali kamar (buat tab-tab di UI)
dashboard.get('/per-wali-kamar', requireRole('admin'), async (c) => {
  const { dari, sampai } = defaultDateRange(c)

  const waliList = await c.env.DB.prepare(
    `SELECT id, email, nama_lengkap, status FROM users WHERE role = 'ustadz' ORDER BY nama_lengkap ASC`
  ).all<{ id: string; email: string; nama_lengkap: string; status: string }>()

  const data = []
  for (const u of waliList.results || []) {
    const kamarAssignments = await c.env.DB.prepare(
      `SELECT k.id, k.nama, k.jenis_kelamin FROM ustadz_kamar uk JOIN kamar k ON uk.kamar_id = k.id WHERE uk.user_id = ? AND k.is_active = 1`
    ).bind(u.id).all<{ id: string; nama: string; jenis_kelamin: string }>()
    const kamarRows = kamarAssignments.results || []
    const kamarIds = kamarRows.map((k) => k.id)

    const stats = await computeKamarStats(c.env, kamarIds, dari, sampai)

    // Info tambahan buat kamar putri: berapa entri suci/haid yang udah tercatat
    // di periode ini — cuma jumlah, bukan detail per-tanggal (tetap dijaga
    // sensitivitasnya walau ditampilin ke admin)
    let catatanHaidTercatat: number | null = null
    const kamarPutriIds = kamarRows.filter((k) => k.jenis_kelamin === 'P').map((k) => k.id)
    if (kamarPutriIds.length > 0) {
      const ph = kamarPutriIds.map(() => '?').join(',')
      const haidCount = await c.env.DB.prepare(`
        SELECT COUNT(*) as count FROM catatan_haid ch
        INNER JOIN santri s ON ch.santri_id = s.id
        WHERE s.kamar_id IN (${ph}) AND ch.tanggal BETWEEN ? AND ?
      `).bind(...kamarPutriIds, dari, sampai).first<{ count: number }>()
      catatanHaidTercatat = haidCount?.count || 0
    }

    data.push({
      id: u.id,
      nama_lengkap: u.nama_lengkap,
      email: u.email,
      status: u.status,
      assigned_kamar: kamarRows,
      catatan_haid_tercatat: catatanHaidTercatat,
      ...stats
    })
  }

  return c.json({ data, period: { dari, sampai } })
})

// GET /api/dashboard/per-wali-kamar/:userId/santri?dari=&sampai= — drill-down per santri
dashboard.get('/per-wali-kamar/:userId/santri', requireRole('admin'), async (c) => {
  const userId = c.req.param('userId')
  const { dari, sampai } = defaultDateRange(c)

  const wali = await c.env.DB.prepare(
    `SELECT id, nama_lengkap FROM users WHERE id = ? AND role = 'ustadz'`
  ).bind(userId).first<{ id: string; nama_lengkap: string }>()

  if (!wali) {
    return c.json({
      error: 'Not Found',
      code: 'USTADZ_NOT_FOUND',
      message: 'Ustadz tidak ditemukan.'
    } as ApiError, 404)
  }

  const kamarAssignments = await c.env.DB.prepare(
    `SELECT kamar_id FROM ustadz_kamar WHERE user_id = ?`
  ).bind(userId).all<{ kamar_id: string }>()
  const kamarIds = (kamarAssignments.results || []).map((r) => r.kamar_id)

  if (kamarIds.length === 0) {
    return c.json({ data: { wali_kamar: wali, santri: [] }, period: { dari, sampai } })
  }

  const ph = kamarIds.map(() => '?').join(',')
  const santriList = await c.env.DB.prepare(
    `SELECT id, nama_lengkap FROM santri WHERE kamar_id IN (${ph}) AND status = 'aktif' ORDER BY nama_lengkap ASC`
  ).bind(...kamarIds).all<{ id: string; nama_lengkap: string }>()

  const santriIds = (santriList.results || []).map((s) => s.id)
  if (santriIds.length === 0) {
    return c.json({ data: { wali_kamar: wali, santri: [] }, period: { dari, sampai } })
  }
  const sph = santriIds.map(() => '?').join(',')

  const [absensiRows, pelanggaranRows, prestasiRows] = await Promise.all([
    c.env.DB.prepare(`
      SELECT santri_id, status, COUNT(*) as jumlah FROM absensi
      WHERE santri_id IN (${sph}) AND tanggal BETWEEN ? AND ?
      GROUP BY santri_id, status
    `).bind(...santriIds, dari, sampai).all<{ santri_id: string; status: string; jumlah: number }>(),

    c.env.DB.prepare(`
      SELECT cd.santri_id, kp.id as kategori_id, kp.nama as kategori_nama, COUNT(*) as jumlah
      FROM catatan_disiplin cd
      LEFT JOIN kategori_pelanggaran kp ON cd.kategori_id = kp.id
      WHERE cd.santri_id IN (${sph}) AND cd.tipe = 'pelanggaran' AND cd.is_deleted = 0
        AND date(cd.tanggal_kejadian) BETWEEN ? AND ?
      GROUP BY cd.santri_id, kp.id
    `).bind(...santriIds, dari, sampai).all<{ santri_id: string; kategori_id: string | null; kategori_nama: string | null; jumlah: number }>(),

    // jenis_prestasi bebas ketik (bukan dropdown tetap) — dikelompokkan apa
    // adanya berdasarkan teks yang sama persis
    c.env.DB.prepare(`
      SELECT santri_id, jenis_prestasi, COUNT(*) as jumlah FROM catatan_disiplin
      WHERE santri_id IN (${sph}) AND tipe = 'prestasi' AND is_deleted = 0
        AND date(tanggal_kejadian) BETWEEN ? AND ?
      GROUP BY santri_id, jenis_prestasi
    `).bind(...santriIds, dari, sampai).all<{ santri_id: string; jenis_prestasi: string | null; jumlah: number }>()
  ])

  const absensiMap = new Map<string, Record<string, number>>()
  for (const row of absensiRows.results || []) {
    if (!absensiMap.has(row.santri_id)) absensiMap.set(row.santri_id, { hadir: 0, sakit: 0, izin: 0, alpa: 0 })
    const entry = absensiMap.get(row.santri_id)!
    if (row.status in entry) entry[row.status] = row.jumlah
  }

  const pelanggaranMap = new Map<string, Array<{ kategori_id: string | null; kategori_nama: string; jumlah: number }>>()
  for (const row of pelanggaranRows.results || []) {
    if (!pelanggaranMap.has(row.santri_id)) pelanggaranMap.set(row.santri_id, [])
    pelanggaranMap.get(row.santri_id)!.push({
      kategori_id: row.kategori_id,
      kategori_nama: row.kategori_nama || 'Tanpa kategori',
      jumlah: row.jumlah
    })
  }

  const prestasiPerJenisMap = new Map<string, Array<{ jenis_prestasi: string; jumlah: number }>>()
  const prestasiTotalMap = new Map<string, number>()
  for (const row of prestasiRows.results || []) {
    if (!prestasiPerJenisMap.has(row.santri_id)) prestasiPerJenisMap.set(row.santri_id, [])
    prestasiPerJenisMap.get(row.santri_id)!.push({
      jenis_prestasi: row.jenis_prestasi || 'Tanpa keterangan jenis',
      jumlah: row.jumlah
    })
    prestasiTotalMap.set(row.santri_id, (prestasiTotalMap.get(row.santri_id) || 0) + row.jumlah)
  }

  const santri = (santriList.results || []).map((s) => ({
    id: s.id,
    nama_lengkap: s.nama_lengkap,
    absensi: absensiMap.get(s.id) || { hadir: 0, sakit: 0, izin: 0, alpa: 0 },
    pelanggaran_per_kategori: pelanggaranMap.get(s.id) || [],
    prestasi_per_jenis: prestasiPerJenisMap.get(s.id) || [],
    prestasi_total: prestasiTotalMap.get(s.id) || 0
  }))

  return c.json({ data: { wali_kamar: wali, santri }, period: { dari, sampai } })
})

export { dashboard as dashboardRoutes }