import { describe, expect, it } from 'vitest'
import { perizinanRoutes } from '../perizinan'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv } from '../../../test/helpers'

async function ajukan(actorToken: string, santriId: string, overrides: Partial<{ tanggal_keluar: string; alasan: string }> = {}) {
  return perizinanRoutes.request('/', {
    method: 'POST',
    headers: authHeaders(actorToken),
    body: JSON.stringify({
      santri_id: santriId,
      tanggal_keluar: overrides.tanggal_keluar ?? '2026-08-01',
      alasan: overrides.alasan ?? 'Acara keluarga'
    })
  }, testEnv())
}

describe('perizinan.ts — ajukan izin pulang (scope kamar/kelas)', () => {
  it('ustadz wali kamar bisa ajukan izin untuk santri di kamarnya', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const res = await ajukan(ustadz.accessToken, santri)
    expect(res.status).toBe(201)
    const body = await res.json() as { data: { status: string } }
    expect(body.data.status).toBe('diajukan')
  })

  it('ustadz TIDAK bisa ajukan izin untuk santri di luar kamar/kelasnya', async () => {
    const kamarLain = await seedKamar({ jenis_kelamin: 'L' })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [] })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamarLain })

    const res = await ajukan(ustadz.accessToken, santri)
    expect(res.status).toBe(403)
  })

  it('kyai (read-only) tidak bisa ajukan izin', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const kyai = await seedUser({ role: 'kyai' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const res = await ajukan(kyai.accessToken, santri)
    expect(res.status).toBe(403)
  })
})

describe('perizinan.ts — approve/tolak berjenjang, bukan sembarang role', () => {
  it('ustadz yang mengajukan TIDAK bisa approve pengajuannya sendiri', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukan(ustadz.accessToken, santri)
    const body = await created.json() as { data: { id: string } }

    const res = await perizinanRoutes.request(`/${body.data.id}/approve`, {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({})
    }, testEnv())
    expect(res.status).toBe(403)
  })

  it('kepala_asrama HANYA bisa approve santri di asramanya sendiri', async () => {
    const kamarPutra = await seedKamar({ jenis_kelamin: 'L' })
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const admin = await seedUser({ role: 'admin' })
    const kepalaPutri = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'P' })
    const santriPutra = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamarPutra })

    const created = await ajukan(admin.accessToken, santriPutra)
    const body = await created.json() as { data: { id: string } }

    const res = await perizinanRoutes.request(`/${body.data.id}/approve`, {
      method: 'POST',
      headers: authHeaders(kepalaPutri.accessToken),
      body: JSON.stringify({})
    }, testEnv())
    expect(res.status).toBe(403)

    const santriPutri = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const created2 = await ajukan(admin.accessToken, santriPutri)
    const body2 = await created2.json() as { data: { id: string } }
    const res2 = await perizinanRoutes.request(`/${body2.data.id}/approve`, {
      method: 'POST',
      headers: authHeaders(kepalaPutri.accessToken),
      body: JSON.stringify({})
    }, testEnv())
    expect(res2.status).toBe(200)
  })

  it('admin bisa approve dari asrama mana saja', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukan(admin.accessToken, santri)
    const body = await created.json() as { data: { id: string } }

    const res = await perizinanRoutes.request(`/${body.data.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({})
    }, testEnv())
    expect(res.status).toBe(200)
    const resultBody = await res.json() as { data: { status: string } }
    expect(resultBody.data.status).toBe('disetujui')
  })

  it('approve/tolak yang sudah diproses ditolak 400 (tidak bisa diproses dua kali)', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukan(admin.accessToken, santri)
    const body = await created.json() as { data: { id: string } }

    await perizinanRoutes.request(`/${body.data.id}/approve`, {
      method: 'POST', headers: authHeaders(admin.accessToken), body: JSON.stringify({})
    }, testEnv())

    const res = await perizinanRoutes.request(`/${body.data.id}/tolak`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ catatan_keputusan: 'terlambat' })
    }, testEnv())
    expect(res.status).toBe(400)
  })

  it('tolak wajib menyertakan catatan_keputusan (400 kalau kosong)', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukan(admin.accessToken, santri)
    const body = await created.json() as { data: { id: string } }

    const res = await perizinanRoutes.request(`/${body.data.id}/tolak`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({})
    }, testEnv())
    expect(res.status).toBe(400)
  })
})

describe('perizinan.ts — alur penuh: ajukan -> approve -> kembali', () => {
  it('tidak bisa ditandai kembali sebelum disetujui', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukan(admin.accessToken, santri)
    const body = await created.json() as { data: { id: string } }

    const res = await perizinanRoutes.request(`/${body.data.id}/kembali`, {
      method: 'POST', headers: authHeaders(admin.accessToken), body: JSON.stringify({})
    }, testEnv())
    expect(res.status).toBe(400)
  })

  it('setelah disetujui, kembali menandai status selesai', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukan(admin.accessToken, santri)
    const body = await created.json() as { data: { id: string } }
    await perizinanRoutes.request(`/${body.data.id}/approve`, {
      method: 'POST', headers: authHeaders(admin.accessToken), body: JSON.stringify({})
    }, testEnv())

    const res = await perizinanRoutes.request(`/${body.data.id}/kembali`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ tanggal_kembali_aktual: '2026-08-05' })
    }, testEnv())
    expect(res.status).toBe(200)
    const resultBody = await res.json() as { data: { status: string; tanggal_kembali_aktual: string } }
    expect(resultBody.data.status).toBe('selesai')
    expect(resultBody.data.tanggal_kembali_aktual).toBe('2026-08-05')
  })
})

describe('perizinan.ts — edit & batalkan hanya selama status diajukan', () => {
  it('bisa diedit selama masih diajukan, tidak bisa lagi setelah disetujui', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukan(admin.accessToken, santri)
    const body = await created.json() as { data: { id: string } }

    const editOk = await perizinanRoutes.request(`/${body.data.id}`, {
      method: 'PUT',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ alasan: 'Diubah' })
    }, testEnv())
    expect(editOk.status).toBe(200)

    await perizinanRoutes.request(`/${body.data.id}/approve`, {
      method: 'POST', headers: authHeaders(admin.accessToken), body: JSON.stringify({})
    }, testEnv())

    const editFail = await perizinanRoutes.request(`/${body.data.id}`, {
      method: 'PUT',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ alasan: 'Diubah lagi' })
    }, testEnv())
    expect(editFail.status).toBe(400)
  })

  it('bisa dibatalkan (DELETE) selama masih diajukan', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukan(admin.accessToken, santri)
    const body = await created.json() as { data: { id: string } }

    const res = await perizinanRoutes.request(`/${body.data.id}`, {
      method: 'DELETE',
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    expect(res.status).toBe(200)

    const row = await testEnv().DB.prepare('SELECT id FROM perizinan_pulang WHERE id = ?').bind(body.data.id).first()
    expect(row).toBeNull()
  })
})
