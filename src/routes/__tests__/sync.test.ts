import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv } from '../../../test/helpers'

// Regresi: GET /api/sync/pull sama-sama cuma scope by kelas_ids kayak catatan.ts dulu.
describe('sync.ts — GET /pull scoping ustadz (kelas OR kamar)', () => {
  it('ustadz kamar-only dapet santri di kamarnya lewat pull', async () => {
    const kamar = await seedKamar()
    await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { changes: { santri: unknown[] } }
    expect(body.changes.santri.length).toBe(1)
  })

  it('ustadz kamar-only TIDAK dapet santri di kamar lain', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { santri: unknown[] } }
    expect(body.changes.santri.length).toBe(0)
  })

  it('ustadz tanpa kelas maupun kamar dapet changeset kosong, bukan error', async () => {
    const ustadz = await seedUser({ role: 'ustadz', kelas_ids: [], kamar_ids: [] })
    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { changes: { santri: unknown[]; catatan_disiplin: unknown[] }; has_more: boolean }
    expect(body.changes.santri).toEqual([])
    expect(body.changes.catatan_disiplin).toEqual([])
    expect(body.has_more).toBe(false)
  })
})
