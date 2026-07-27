import { describe, expect, it } from 'vitest'
import { santriRoutes } from '../santri'
import { authHeaders, seedKamar, seedKelas, seedSantri, seedUser, testEnv } from '../../../test/helpers'

describe('santri.ts — list scoping ustadz (kelas OR kamar)', () => {
  it('ustadz kamar-only cuma lihat santri di kamarnya', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    await seedSantri({ kamar_id: kamarMine })
    await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await santriRoutes.request('/', { headers: authHeaders(ustadz.accessToken) }, testEnv())
    const body = await res.json() as { data: unknown[] }
    expect(body.data.length).toBe(1)
  })

  it('ustadz tanpa kelas/kamar dapat list kosong', async () => {
    const ustadz = await seedUser({ role: 'ustadz', kelas_ids: [], kamar_ids: [] })
    const res = await santriRoutes.request('/', { headers: authHeaders(ustadz.accessToken) }, testEnv())
    const body = await res.json() as { data: unknown[] }
    expect(body.data).toEqual([])
  })
})

describe('santri.ts — GET /:id, santri tanpa assignment TIDAK bisa diakses ustadz acak (B14 fix)', () => {
  it('santri tanpa kelas & kamar TIDAK bisa diliat ustadz yang tidak terkait (403)', async () => {
    const santri = await seedSantri({ kelas_id: null, kamar_id: null })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [await seedKamar()] })

    const res = await santriRoutes.request(`/${santri}`, { headers: authHeaders(ustadz.accessToken) }, testEnv())
    expect(res.status).toBe(403)
  })

  it('santri dengan kamar tertentu TIDAK bisa diliat ustadz kamar lain', async () => {
    const kamarOther = await seedKamar()
    const santri = await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [await seedKamar()] })

    const res = await santriRoutes.request(`/${santri}`, { headers: authHeaders(ustadz.accessToken) }, testEnv())
    expect(res.status).toBe(403)
  })
})

describe('santri.ts — DELETE /:id scoping (regresi: dulu cuma cek kelas_id, bisa dilewati kalau kelas_id null)', () => {
  it('ustadz kamar-only bisa "keluarkan" santri di kamarnya', async () => {
    const kamar = await seedKamar()
    const santri = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await santriRoutes.request(`/${santri}`, { method: 'DELETE', headers: authHeaders(ustadz.accessToken) }, testEnv())
    expect(res.status).toBe(200)
  })

  it('ustadz TIDAK bisa "keluarkan" santri kamar lain, meski santri itu gak punya kelas_id', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    const santri = await seedSantri({ kamar_id: kamarOther, kelas_id: null })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await santriRoutes.request(`/${santri}`, { method: 'DELETE', headers: authHeaders(ustadz.accessToken) }, testEnv())
    expect(res.status).toBe(403)
  })
})

// Audit MEDIUM #6: single-create (POST /) sudah cek gender kamar vs santri, tapi
// bulk import (POST /bulk) belum — bisa nyelipin santri putri ke kamar putra dst.
describe('santri.ts — POST /bulk juga divalidasi gender-nya, bukan cuma single-create', () => {
  it('baris dengan gender santri tidak cocok kamar ditolak KAMAR_GENDER_MISMATCH, baris valid lain di batch yang sama tetap sukses', async () => {
    const kamarPutra = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })

    const res = await santriRoutes.request('/bulk', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        santri: [
          { nama_lengkap: 'Santri Putri Salah Kamar', jenis_kelamin: 'P', kamar_id: kamarPutra },
          { nama_lengkap: 'Santri Putra Benar', jenis_kelamin: 'L', kamar_id: kamarPutra }
        ]
      })
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { data: { results: Array<{ row: number; status: string; error?: string }> } }
    expect(body.data.results[0]).toMatchObject({ row: 0, status: 'error', error: 'KAMAR_GENDER_MISMATCH' })
    expect(body.data.results[1]).toMatchObject({ row: 1, status: 'created' })
  })
})
