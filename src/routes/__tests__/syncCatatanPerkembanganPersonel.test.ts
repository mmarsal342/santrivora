import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv, uuid } from '../../../test/helpers'

// Fase 3 offline-first: catatan_perkembangan (via-santri, mirror catatan_disiplin)
// dan catatan_personel (role-only admin+kyai, TANPA dimensi kelas/kamar sama
// sekali — dan kyai SENGAJA boleh menulis, beda dari default readOnlyRoles).

describe('sync.ts — catatan_perkembangan push create', () => {
  it('ustadz dengan akses kamar bisa bikin catatan perkembangan', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{
          entity_type: 'catatan_perkembangan', local_id: 'l1', action: 'create', version: 0,
          data: { santri_id: santriId, tanggal: '2026-07-01', kategori: 'Akademik', judul: 'Nilai bagus' }
        }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; server_id?: string }> }
    expect(body.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT dicatat_oleh FROM catatan_perkembangan WHERE id = ?').bind(body.results[0].server_id).first<{ dicatat_oleh: string }>()
    expect(row?.dicatat_oleh).toBe(ustadz.id)
  })

  it('ustadz TANPA akses ke santri ditolak NOT_ASSIGNED', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_perkembangan', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', kategori: 'Sosial', judul: 'X' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('NOT_ASSIGNED')
  })

  it('update dengan version basi disimpan sebagai pending conflict', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const catatanId = uuid()
    await testEnv().DB.prepare(
      `INSERT INTO catatan_perkembangan (id, santri_id, tanggal, kategori, judul, dicatat_oleh, version) VALUES (?, ?, '2026-07-01', 'Akademik', 'Awal', ?, 1)`
    ).bind(catatanId, santriId, ustadz.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_perkembangan', local_id: 'l1', action: 'update', version: 0, data: { id: catatanId, judul: 'Revisi client' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('conflict')

    const stored = await testEnv().DB.prepare(
      "SELECT entity_type FROM sync_conflicts WHERE entity_id = ? AND status = 'pending'"
    ).bind(catatanId).first<{ entity_type: string }>()
    expect(stored?.entity_type).toBe('catatan_perkembangan')
  })
})

describe('sync.ts — catatan_personel (role-only admin+kyai, kyai SENGAJA boleh menulis)', () => {
  it('admin bisa bikin catatan personel', async () => {
    const admin = await seedUser({ role: 'admin' })
    const target = await seedUser({ role: 'ustadz' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_personel', local_id: 'l1', action: 'create', version: 0, data: { personel_id: target.id, tanggal: '2026-07-01', kategori: 'Kinerja', judul: 'Bagus' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')
  })

  it('kyai JUGA bisa bikin catatan personel (readOnlyRoles override, beda dari entity lain)', async () => {
    const kyai = await seedUser({ role: 'kyai' })
    const target = await seedUser({ role: 'ustadz' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(kyai.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_personel', local_id: 'l1', action: 'create', version: 0, data: { personel_id: target.id, tanggal: '2026-07-01', kategori: 'Keputusan Kyai', judul: 'Catatan' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')
  })

  it('ustadz TIDAK bisa bikin catatan personel', async () => {
    const ustadz = await seedUser({ role: 'ustadz' })
    const target = await seedUser({ role: 'ustadz' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_personel', local_id: 'l1', action: 'create', version: 0, data: { personel_id: target.id, tanggal: '2026-07-01', kategori: 'Kinerja', judul: 'X' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('INSUFFICIENT_PERMISSIONS')
  })

  it('personel_id yang tidak ada ditolak PERSONEL_NOT_FOUND', async () => {
    const admin = await seedUser({ role: 'admin' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_personel', local_id: 'l1', action: 'create', version: 0, data: { personel_id: uuid(), tanggal: '2026-07-01', kategori: 'Kinerja', judul: 'X' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('PERSONEL_NOT_FOUND')
  })

  it('ustadz TIDAK bisa pull catatan_personel (role-only, bukan cuma diblokir nulis)', async () => {
    const admin = await seedUser({ role: 'admin' })
    const target = await seedUser({ role: 'ustadz' })
    const ustadz = await seedUser({ role: 'ustadz' })
    await testEnv().DB.prepare(
      "INSERT INTO catatan_personel (id, personel_id, tanggal, kategori, judul, dicatat_oleh, version) VALUES (?, ?, '2026-07-01', 'Kinerja', 'X', ?, 1)"
    ).bind(uuid(), target.id, admin.id).run()

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { catatan_personel: unknown[] } }
    expect(body.changes.catatan_personel.length).toBe(0)
  })
})

describe('sync.ts — kyai tetap READ_ONLY_ROLE di entity lain (readOnlyRoles default tidak berubah)', () => {
  it('kyai TIDAK bisa push santri (default readOnlyRoles masih berlaku)', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const kyai = await seedUser({ role: 'kyai' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(kyai.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'santri', local_id: 'l1', action: 'update', version: 1, data: { id: santriId, nama_lengkap: 'Coba Ubah' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('READ_ONLY_ROLE')
  })
})
