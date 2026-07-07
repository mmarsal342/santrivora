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

describe('santri.ts — GET /:id, santri tanpa assignment bisa diakses siapa aja', () => {
  it('santri tanpa kelas & kamar bisa diliat ustadz manapun', async () => {
    const santri = await seedSantri({ kelas_id: null, kamar_id: null })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [await seedKamar()] })

    const res = await santriRoutes.request(`/${santri}`, { headers: authHeaders(ustadz.accessToken) }, testEnv())
    expect(res.status).toBe(200)
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
