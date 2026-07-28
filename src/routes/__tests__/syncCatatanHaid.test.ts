import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv, uuid } from '../../../test/helpers'

// Fase 4 offline-first: catatan_haid — satu-satunya entity yang blokir kyai
// TOTAL dari baris individual (assertHaidAccess), natural-key upsert per hari
// (mirror POST / yang ada), dan sekarang soft-delete (migrasi 017) buat
// mendukung tombstone di pull.

describe('sync.ts — catatan_haid push create (natural-key upsert)', () => {
  it('ustadz wali kamar putri bisa catat status haid', async () => {
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const wali = await seedUser({ role: 'ustadz', kamar_ids: [kamarPutri] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(wali.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_haid', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'haid' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; server_id?: string }> }
    expect(body.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT dicatat_oleh FROM catatan_haid WHERE id = ?').bind(body.results[0].server_id).first<{ dicatat_oleh: string }>()
    expect(row?.dicatat_oleh).toBe(wali.id)
  })

  it('create kedua kali di tanggal sama meng-upsert baris yang sama', async () => {
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const wali = await seedUser({ role: 'ustadz', kamar_ids: [kamarPutri] })

    const res1 = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(wali.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_haid', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'haid' } }]
      })
    }, testEnv())
    const body1 = await res1.json() as { results: Array<{ server_id?: string }> }

    const res2 = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(wali.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_haid', local_id: 'l2', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'suci' } }]
      })
    }, testEnv())
    const body2 = await res2.json() as { results: Array<{ server_id?: string }> }

    expect(body2.results[0].server_id).toBe(body1.results[0].server_id)
    const count = await testEnv().DB.prepare('SELECT COUNT(*) as n FROM catatan_haid WHERE santri_id = ?').bind(santriId).first<{ n: number }>()
    expect(count?.n).toBe(1)
  })

  it('kyai TIDAK bisa push catatan_haid sama sekali (READ_ONLY_ROLE)', async () => {
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const kyai = await seedUser({ role: 'kyai' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(kyai.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_haid', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'haid' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('READ_ONLY_ROLE')
  })

  it('ustadz BUKAN wali kamar putri ditolak', async () => {
    const kamarOther = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_haid', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'haid' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('NOT_WALI_KAMAR_PUTRI')
  })
})

describe('sync.ts — catatan_haid pull scoping (kyai excluded total, admin/kepala_asrama putri/wali kamar putri boleh)', () => {
  it('kyai dapet changeset KOSONG (bukan error) — beda dari entity lain yang cuma restrict per-baris', async () => {
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const wali = await seedUser({ role: 'ustadz', kamar_ids: [kamarPutri] })
    await testEnv().DB.prepare(
      "INSERT INTO catatan_haid (id, santri_id, tanggal, status, dicatat_oleh, version) VALUES (?, ?, '2026-07-01', 'haid', ?, 1)"
    ).bind(uuid(), santriId, wali.id).run()

    const kyai = await seedUser({ role: 'kyai' })
    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(kyai.accessToken)
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { changes: { catatan_haid: unknown[] } }
    expect(body.changes.catatan_haid.length).toBe(0)
  })

  it('wali kamar putri dapet catatan haid santrinya lewat pull', async () => {
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const wali = await seedUser({ role: 'ustadz', kamar_ids: [kamarPutri] })
    await testEnv().DB.prepare(
      "INSERT INTO catatan_haid (id, santri_id, tanggal, status, dicatat_oleh, version) VALUES (?, ?, '2026-07-01', 'haid', ?, 1)"
    ).bind(uuid(), santriId, wali.id).run()

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(wali.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { catatan_haid: unknown[] } }
    expect(body.changes.catatan_haid.length).toBe(1)
  })
})

describe('sync.ts — catatan_haid push delete (soft-delete/tombstone, migrasi 017)', () => {
  it('delete menandai is_deleted=1, tidak menghapus baris beneran', async () => {
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const wali = await seedUser({ role: 'ustadz', kamar_ids: [kamarPutri] })
    const catatanId = uuid()
    await testEnv().DB.prepare(
      "INSERT INTO catatan_haid (id, santri_id, tanggal, status, dicatat_oleh, version) VALUES (?, ?, '2026-07-01', 'haid', ?, 1)"
    ).bind(catatanId, santriId, wali.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(wali.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_haid', local_id: 'l1', action: 'delete', version: 1, data: { id: catatanId, santri_id: santriId } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT is_deleted FROM catatan_haid WHERE id = ?').bind(catatanId).first<{ is_deleted: number }>()
    expect(row?.is_deleted).toBe(1)
  })
})
