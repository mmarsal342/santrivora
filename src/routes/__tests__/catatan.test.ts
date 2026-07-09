import { describe, expect, it } from 'vitest'
import { catatanRoutes } from '../catatan'
import { authHeaders, seedKamar, seedKelas, seedSantri, seedUser, testEnv } from '../../../test/helpers'

// Regresi buat bug yang ketemu 7 Jul 2026: catatan.ts cuma scope by kelas_ids,
// jadi ustadz kamar-only (kelas_ids = []) selalu liat list kosong dan bisa
// nyatet buat santri di luar kamarnya kalau santri itu gak punya kelas_id.
describe('catatan.ts — scoping ustadz (kelas OR kamar)', () => {
  it('ustadz kamar-only bisa lihat catatan santri di kamarnya (list)', async () => {
    const kamar = await seedKamar()
    const santri = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    await testEnv().DB.prepare(
      `INSERT INTO catatan_disiplin (id, santri_id, tipe, judul, tanggal_kejadian, dicatat_oleh)
       VALUES (?, ?, 'pelanggaran', 'Telat sholat', '2026-07-01', ?)`
    ).bind(crypto.randomUUID(), santri, ustadz.id).run()

    const res = await catatanRoutes.request('/', { headers: authHeaders(ustadz.accessToken) }, testEnv())
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[] }
    expect(body.data.length).toBe(1)
  })

  it('ustadz kamar-only TIDAK bisa lihat catatan santri di kamar lain (list kosong)', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    const santriOther = await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    await testEnv().DB.prepare(
      `INSERT INTO catatan_disiplin (id, santri_id, tipe, judul, tanggal_kejadian, dicatat_oleh)
       VALUES (?, ?, 'pelanggaran', 'Bukan urusan dia', '2026-07-01', ?)`
    ).bind(crypto.randomUUID(), santriOther, ustadz.id).run()

    const res = await catatanRoutes.request('/', { headers: authHeaders(ustadz.accessToken) }, testEnv())
    const body = await res.json() as { data: unknown[] }
    expect(body.data.length).toBe(0)
  })

  it('ustadz TANPA kelas maupun kamar dapat list kosong, bukan error/semua data', async () => {
    const ustadz = await seedUser({ role: 'ustadz', kelas_ids: [], kamar_ids: [] })
    const res = await catatanRoutes.request('/', { headers: authHeaders(ustadz.accessToken) }, testEnv())
    expect(res.status).toBe(200)
    const body = await res.json() as { data: unknown[] }
    expect(body.data).toEqual([])
  })

  it('POST: ustadz bisa nyatet buat santri di kamar yang dia pegang', async () => {
    const kamar = await seedKamar()
    const santri = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await catatanRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        santri_id: santri,
        tipe: 'pelanggaran',
        judul: 'Terlambat',
        tanggal_kejadian: '2026-07-01'
      })
    }, testEnv())

    expect(res.status).toBe(201)
  })

  it('POST: ustadz TIDAK bisa nyatet buat santri di kamar orang lain (403)', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    const santriOther = await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await catatanRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        santri_id: santriOther,
        tipe: 'pelanggaran',
        judul: 'Bukan wewenang dia',
        tanggal_kejadian: '2026-07-01'
      })
    }, testEnv())

    expect(res.status).toBe(403)
  })

  it('POST: santri tanpa kelas & tanpa kamar TIDAK bisa dicatat ustadz yang tidak terkait (B14 fix)', async () => {
    const santri = await seedSantri({ kelas_id: null, kamar_id: null })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [await seedKamar()] })

    const res = await catatanRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        santri_id: santri,
        tipe: 'prestasi',
        judul: 'Hafal 1 juz',
        tanggal_kejadian: '2026-07-01'
      })
    }, testEnv())

    expect(res.status).toBe(403)
  })

  it('admin selalu bisa lihat semua catatan lintas kamar/kelas', async () => {
    const kamar = await seedKamar()
    const santri = await seedSantri({ kamar_id: kamar })
    const admin = await seedUser({ role: 'admin' })

    await testEnv().DB.prepare(
      `INSERT INTO catatan_disiplin (id, santri_id, tipe, judul, tanggal_kejadian, dicatat_oleh)
       VALUES (?, ?, 'pelanggaran', 'Test', '2026-07-01', ?)`
    ).bind(crypto.randomUUID(), santri, admin.id).run()

    const res = await catatanRoutes.request('/', { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res.json() as { data: unknown[] }
    expect(body.data.length).toBeGreaterThanOrEqual(1)
  })

  it('legacy: ustadz dengan kelas_ids (bukan kamar) tetap bisa akses — jangan sampai regresi ke arah sebaliknya', async () => {
    const kelas = await seedKelas()
    const santri = await seedSantri({ kelas_id: kelas })
    const ustadz = await seedUser({ role: 'ustadz', kelas_ids: [kelas] })

    await testEnv().DB.prepare(
      `INSERT INTO catatan_disiplin (id, santri_id, tipe, judul, tanggal_kejadian, dicatat_oleh)
       VALUES (?, ?, 'pelanggaran', 'Test kelas', '2026-07-01', ?)`
    ).bind(crypto.randomUUID(), santri, ustadz.id).run()

    const res = await catatanRoutes.request('/', { headers: authHeaders(ustadz.accessToken) }, testEnv())
    const body = await res.json() as { data: unknown[] }
    expect(body.data.length).toBe(1)
  })
})
