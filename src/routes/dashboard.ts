import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import type { Env, UserPayload } from '../types'

const dashboard = new Hono<{ Bindings: Env; Variables: { user: UserPayload } }>()

dashboard.use('*', authMiddleware)

// GET /api/dashboard/summary
dashboard.get('/summary', requireRole('admin'), async (c) => {
  const totalSantri = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM santri WHERE status = 'aktif'"
  ).first<{ count: number }>()

  const totalKelas = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM kelas WHERE is_active = 1'
  ).first<{ count: number }>()

  const totalPelanggaran = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM catatan_disiplin WHERE tipe = 'pelanggaran' AND is_deleted = 0 AND date(tanggal_kejadian) >= date('now', '-30 days')"
  ).first<{ count: number }>()

  const totalPrestasi = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM catatan_disiplin WHERE tipe = 'prestasi' AND is_deleted = 0 AND date(tanggal_kejadian) >= date('now', '-30 days')"
  ).first<{ count: number }>()

  // Violations per kategori
  const perKategori = await c.env.DB.prepare(`
    SELECT kp.id, kp.nama, kp.urutan_keparahan, COUNT(cd.id) as total
    FROM kategori_pelanggaran kp
    LEFT JOIN catatan_disiplin cd ON cd.kategori_id = kp.id
      AND cd.tipe = 'pelanggaran' AND cd.is_deleted = 0
      AND date(cd.tanggal_kejadian) >= date('now', '-30 days')
    WHERE kp.is_active = 1
    GROUP BY kp.id
    ORDER BY total DESC
  `).all()

  // Per kelas breakdown
  const perKelas = await c.env.DB.prepare(`
    SELECT k.id, k.nama,
      COUNT(CASE WHEN cd.tipe = 'pelanggaran' THEN 1 END) as pelanggaran,
      COUNT(CASE WHEN cd.tipe = 'prestasi' THEN 1 END) as prestasi,
      COUNT(DISTINCT s.id) as jumlah_santri
    FROM kelas k
    LEFT JOIN santri s ON s.kelas_id = k.id AND s.status = 'aktif'
    LEFT JOIN catatan_disiplin cd ON cd.santri_id = s.id AND cd.is_deleted = 0
      AND date(cd.tanggal_kejadian) >= date('now', '-30 days')
    WHERE k.is_active = 1
    GROUP BY k.id
    ORDER BY k.nama
  `).all()

  // Top santri with most violations
  const topPelanggar = await c.env.DB.prepare(`
    SELECT s.id, s.nama_lengkap, k.nama as kelas_nama, COUNT(cd.id) as total
    FROM santri s
    LEFT JOIN kelas k ON s.kelas_id = k.id
    INNER JOIN catatan_disiplin cd ON cd.santri_id = s.id
      AND cd.tipe = 'pelanggaran' AND cd.is_deleted = 0
      AND date(cd.tanggal_kejadian) >= date('now', '-30 days')
    WHERE s.status = 'aktif'
    GROUP BY s.id
    ORDER BY total DESC
    LIMIT 10
  `).all()

  return c.json({
    data: {
      totals: {
        santri: totalSantri?.count || 0,
        kelas: totalKelas?.count || 0,
        pelanggaran_30hari: totalPelanggaran?.count || 0,
        prestasi_30hari: totalPrestasi?.count || 0
      },
      per_kategori: perKelas.results,
      per_kelas: perKelas.results,
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

export { dashboard as dashboardRoutes }