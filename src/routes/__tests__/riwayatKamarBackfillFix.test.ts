import { describe, expect, it } from 'vitest'
import { seedKamar, seedSantri, testEnv } from '../../../test/helpers'

// Migrasi 013 sudah jalan (no-op) saat DB test dibangun dari kosong, sebelum
// seed manapun ada — jadi tidak bisa diuji lewat "replay migrasi" seperti
// biasa. Test ini memverifikasi LOGIKA SQL koreksinya secara langsung:
// simulasikan kondisi rusak peninggalan backfill migrasi 011 (span terbuka
// untuk santri yang statusnya sudah bukan 'aktif'), lalu jalankan ulang
// statement UPDATE yang sama persis dengan migrasi 013.
const FIX_STATEMENT = `
  UPDATE riwayat_kamar_santri
  SET selesai_at = datetime('now')
  WHERE selesai_at IS NULL
    AND santri_id IN (SELECT id FROM santri WHERE status != 'aktif')
`

describe('migrasi 013 — koreksi backfill riwayat_kamar_santri (bug migrasi 011)', () => {
  it('menutup span terbuka milik santri yang statusnya SUDAH bukan aktif (peninggalan backfill 011)', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const santriLulus = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar, status: 'lulus' })

    // Simulasikan span "terbuka selamanya" persis seperti hasil backfill
    // migrasi 011 yang lama (sebelum dikoreksi) — kamar_id masih ada tapi
    // status santrinya sudah bukan aktif.
    await testEnv().DB.prepare(
      "INSERT INTO riwayat_kamar_santri (id, santri_id, kamar_id, selesai_at) VALUES (?, ?, ?, NULL)"
    ).bind(crypto.randomUUID(), santriLulus, kamar).run()

    await testEnv().DB.prepare(FIX_STATEMENT).run()

    const row = await testEnv().DB.prepare(
      'SELECT selesai_at FROM riwayat_kamar_santri WHERE santri_id = ?'
    ).bind(santriLulus).first<{ selesai_at: string | null }>()
    expect(row?.selesai_at).not.toBeNull()
  })

  it('TIDAK menyentuh span terbuka milik santri yang masih aktif', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const santriAktif = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar, status: 'aktif' })

    await testEnv().DB.prepare(
      "INSERT INTO riwayat_kamar_santri (id, santri_id, kamar_id, selesai_at) VALUES (?, ?, ?, NULL)"
    ).bind(crypto.randomUUID(), santriAktif, kamar).run()

    await testEnv().DB.prepare(FIX_STATEMENT).run()

    const row = await testEnv().DB.prepare(
      'SELECT selesai_at FROM riwayat_kamar_santri WHERE santri_id = ?'
    ).bind(santriAktif).first<{ selesai_at: string | null }>()
    expect(row?.selesai_at).toBeNull()
  })

  it('tidak mengubah data santri itu sendiri (nama/status tetap ada, cuma riwayat kamarnya yang ditutup)', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'P' })
    const santriKeluar = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamar, status: 'keluar', nama_lengkap: 'Santri Dummy Keluar' })

    await testEnv().DB.prepare(
      "INSERT INTO riwayat_kamar_santri (id, santri_id, kamar_id, selesai_at) VALUES (?, ?, ?, NULL)"
    ).bind(crypto.randomUUID(), santriKeluar, kamar).run()

    await testEnv().DB.prepare(FIX_STATEMENT).run()

    const santriRow = await testEnv().DB.prepare('SELECT nama_lengkap, status, kamar_id FROM santri WHERE id = ?').bind(santriKeluar)
      .first<{ nama_lengkap: string; status: string; kamar_id: string }>()
    expect(santriRow?.nama_lengkap).toBe('Santri Dummy Keluar')
    expect(santriRow?.status).toBe('keluar')
    expect(santriRow?.kamar_id).toBe(kamar)
  })
})
