import { describe, expect, it } from 'vitest'
import { dashboardRoutes } from '../dashboard'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv, uuid } from '../../../test/helpers'

// Audit MEDIUM #1: catatanHaid.ts (assertHaidAccess) eksplisit blokir kyai dari
// data haid (data sensitif santri putri) walau kyai global-read di tempat lain.
// Dashboard /per-wali-kamar sebelumnya gak ikut aturan itu — kyai tetap dapat
// agregat catatan_haid_tercatat per wali kamar putri.
describe('dashboard.ts — GET /per-wali-kamar tidak bocorin data haid ke kyai (audit MEDIUM #1)', () => {
  it('kyai dapat catatan_haid_tercatat = null, admin tetap dapat angka yang benar', async () => {
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const wali = await seedUser({ role: 'ustadz', kamar_ids: [kamarPutri] })

    await testEnv().DB.prepare(
      `INSERT INTO catatan_haid (id, santri_id, tanggal, status, dicatat_oleh)
       VALUES (?, ?, date('now'), 'haid', ?)`
    ).bind(uuid(), santriId, wali.id).run()

    const kyai = await seedUser({ role: 'kyai' })
    const kyaiRes = await dashboardRoutes.request('/per-wali-kamar', { headers: authHeaders(kyai.accessToken) }, testEnv())
    expect(kyaiRes.status).toBe(200)
    const kyaiBody = await kyaiRes.json() as { data: Array<{ id: string; catatan_haid_tercatat: number | null }> }
    const kyaiEntry = kyaiBody.data.find((d) => d.id === wali.id)
    expect(kyaiEntry?.catatan_haid_tercatat).toBeNull()

    const admin = await seedUser({ role: 'admin' })
    const adminRes = await dashboardRoutes.request('/per-wali-kamar', { headers: authHeaders(admin.accessToken) }, testEnv())
    expect(adminRes.status).toBe(200)
    const adminBody = await adminRes.json() as { data: Array<{ id: string; catatan_haid_tercatat: number | null }> }
    const adminEntry = adminBody.data.find((d) => d.id === wali.id)
    expect(adminEntry?.catatan_haid_tercatat).toBe(1)
  })
})
