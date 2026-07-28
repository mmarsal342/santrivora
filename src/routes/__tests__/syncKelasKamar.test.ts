import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKamar, seedKelas, seedUser, testEnv } from '../../../test/helpers'

// Fase 5 offline-first: kelas & kamar — pull-only. Client offline dapet data
// segar buat label/dropdown lewat sync/pull, tapi TIDAK bisa menulis kelas/
// kamar lewat /api/sync sama sekali (tetap lewat REST endpoint admin biasa).

describe('sync.ts — kelas/kamar TIDAK bisa di-push (pull-only)', () => {
  it('push entity_type kelas ditolak validasi (Unknown entity type / bukan entity yang push-eligible)', async () => {
    const admin = await seedUser({ role: 'admin' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kelas', local_id: 'l1', action: 'create', version: 0, data: { nama: 'Kelas Baru' } }]
      })
    }, testEnv())

    // zValidator menolak sebelum sempat masuk ke processPushItem karena
    // 'kelas' tidak ada di pushEligibleEntityTypes() (capability !== 'full').
    expect(res.status).toBe(400)
  })
})

describe('sync.ts — kelas GET /pull (scope sama seperti kelas.ts GET /)', () => {
  it('admin dapat semua kelas', async () => {
    await seedKelas()
    await seedKelas()
    const admin = await seedUser({ role: 'admin' })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(admin.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kelas: unknown[] } }
    expect(body.changes.kelas.length).toBe(2)
  })

  it('ustadz cuma dapat kelas yang dipegangnya', async () => {
    const kelasMine = await seedKelas()
    await seedKelas()
    const ustadz = await seedUser({ role: 'ustadz', kelas_ids: [kelasMine] })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kelas: unknown[] } }
    expect(body.changes.kelas.length).toBe(1)
  })

  it('kepala_asrama dapat changeset kosong buat kelas (tidak punya dimensi kelas)', async () => {
    await seedKelas()
    const kepalaAsrama = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'L' })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(kepalaAsrama.accessToken)
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { changes: { kelas: unknown[] } }
    expect(body.changes.kelas.length).toBe(0)
  })
})

describe('sync.ts — kamar GET /pull (scope sama seperti kamar.ts GET / via resolveKamarScope)', () => {
  it('admin dapat semua kamar', async () => {
    await seedKamar()
    await seedKamar()
    const admin = await seedUser({ role: 'admin' })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(admin.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kamar: unknown[] } }
    expect(body.changes.kamar.length).toBe(2)
  })

  it('ustadz cuma dapat kamar yang dipegangnya', async () => {
    const kamarMine = await seedKamar()
    await seedKamar()
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kamar: unknown[] } }
    expect(body.changes.kamar.length).toBe(1)
  })

  it('kepala_asrama dapat kamar di asramanya', async () => {
    const kamarPutra = await seedKamar({ jenis_kelamin: 'L' })
    await seedKamar({ jenis_kelamin: 'P' })
    const kepalaAsrama = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'L' })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(kepalaAsrama.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kamar: Array<{ id: string }> } }
    expect(body.changes.kamar.length).toBe(1)
    expect(body.changes.kamar[0].id).toBe(kamarPutra)
  })
})
