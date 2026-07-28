import { describe, expect, it } from 'vitest'
import { kelasRoutes } from '../kelas'
import { authHeaders, seedKamar, seedKelas, seedSantri, seedUser, testEnv } from '../../../test/helpers'

describe('kelas.ts — POST /:id/naikkan (kenaikan kelas massal)', () => {
  it('bukan admin ditolak 403', async () => {
    const kelasLama = await seedKelas()
    const kelasBaru = await seedKelas()
    const ustadz = await seedUser({ role: 'ustadz' })

    const res = await kelasRoutes.request(`/${kelasLama}/naikkan`, {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({ lulus: false, target_kelas_id: kelasBaru })
    }, testEnv())
    expect(res.status).toBe(403)
  })

  it('naik kelas biasa: kelas_id berubah, kamar_id TIDAK disentuh sama sekali', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kelasLama = await seedKelas()
    const kelasBaru = await seedKelas()
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kelas_id: kelasLama, kamar_id: kamar })

    const res = await kelasRoutes.request(`/${kelasLama}/naikkan`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ lulus: false, target_kelas_id: kelasBaru })
    }, testEnv())
    expect(res.status).toBe(200)

    const row = await testEnv().DB.prepare('SELECT kelas_id, kamar_id, status FROM santri WHERE id = ?').bind(santri).first<{ kelas_id: string; kamar_id: string; status: string }>()
    expect(row?.kelas_id).toBe(kelasBaru)
    expect(row?.kamar_id).toBe(kamar)
    expect(row?.status).toBe('aktif')
  })

  it('lulus: status jadi lulus, kelas_id/kamar_id tetap, riwayat kamar ditutup', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kelasAkhir = await seedKelas()
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kelas_id: kelasAkhir, kamar_id: kamar })

    const res = await kelasRoutes.request(`/${kelasAkhir}/naikkan`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ lulus: true })
    }, testEnv())
    expect(res.status).toBe(200)

    const row = await testEnv().DB.prepare('SELECT kelas_id, kamar_id, status FROM santri WHERE id = ?').bind(santri).first<{ kelas_id: string; kamar_id: string; status: string }>()
    expect(row?.status).toBe('lulus')
    expect(row?.kelas_id).toBe(kelasAkhir)
    expect(row?.kamar_id).toBe(kamar)

    const riwayat = await testEnv().DB.prepare('SELECT selesai_at FROM riwayat_kamar_santri WHERE santri_id = ?').bind(santri).first<{ selesai_at: string | null }>()
    expect(riwayat?.selesai_at).not.toBeNull()
  })

  it('target_kelas_id sama dengan kelas asal ditolak 400', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kelasLama = await seedKelas()

    const res = await kelasRoutes.request(`/${kelasLama}/naikkan`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ lulus: false, target_kelas_id: kelasLama })
    }, testEnv())
    expect(res.status).toBe(400)
  })

  it('santri_ids yang bukan di kelas asal ditolak 400 (tidak silent-skip)', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kelasLama = await seedKelas()
    const kelasLain = await seedKelas()
    const kelasBaru = await seedKelas()
    const santriLain = await seedSantri({ jenis_kelamin: 'L', kelas_id: kelasLain })

    const res = await kelasRoutes.request(`/${kelasLama}/naikkan`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ lulus: false, target_kelas_id: kelasBaru, santri_ids: [santriLain] })
    }, testEnv())
    expect(res.status).toBe(400)
  })

  it('santri_ids spesifik: cuma yang dipilih yang naik, sisanya di kelas lama tidak berubah', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kelasLama = await seedKelas()
    const kelasBaru = await seedKelas()
    const santriA = await seedSantri({ jenis_kelamin: 'L', kelas_id: kelasLama })
    const santriB = await seedSantri({ jenis_kelamin: 'L', kelas_id: kelasLama })

    const res = await kelasRoutes.request(`/${kelasLama}/naikkan`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ lulus: false, target_kelas_id: kelasBaru, santri_ids: [santriA] })
    }, testEnv())
    expect(res.status).toBe(200)

    const rowA = await testEnv().DB.prepare('SELECT kelas_id FROM santri WHERE id = ?').bind(santriA).first<{ kelas_id: string }>()
    const rowB = await testEnv().DB.prepare('SELECT kelas_id FROM santri WHERE id = ?').bind(santriB).first<{ kelas_id: string }>()
    expect(rowA?.kelas_id).toBe(kelasBaru)
    expect(rowB?.kelas_id).toBe(kelasLama)
  })
})
