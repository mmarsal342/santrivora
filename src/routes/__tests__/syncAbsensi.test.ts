import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv, uuid } from '../../../test/helpers'

// Fase 1 offline-first: entity `absensi` masuk ke sync engine generik (bukan
// hanya santri/catatan_disiplin lagi). Test ini membuktikan pola natural-key
// upsert-on-create, scope kamar-murni (tanpa dimensi kelas), dan validasi
// kegiatan_id — semuanya lewat jalur generik yang sama dengan santri/catatan.

describe('sync.ts — absensi push create (natural-key upsert, mirror /bulk)', () => {
  it('create pertama kali untuk (santri, tanggal, tanpa kegiatan) berhasil dan synced', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{
          entity_type: 'absensi', local_id: 'l1', action: 'create', version: 0,
          data: { santri_id: santriId, tanggal: '2026-07-01', status: 'hadir' }
        }]
      })
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { results: Array<{ status: string; server_id?: string; server_version?: number }> }
    expect(body.results[0].status).toBe('synced')
    expect(body.results[0].server_version).toBe(1)

    const row = await testEnv().DB.prepare('SELECT status, dicatat_oleh FROM absensi WHERE id = ?').bind(body.results[0].server_id).first<{ status: string; dicatat_oleh: string }>()
    expect(row?.status).toBe('hadir')
    expect(row?.dicatat_oleh).toBe(ustadz.id)
  })

  it('create kedua kali dengan (santri, tanggal, kegiatan) yang sama meng-upsert baris yang sama, bukan duplikat', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res1 = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'hadir' } }]
      })
    }, testEnv())
    const body1 = await res1.json() as { results: Array<{ server_id?: string }> }
    const firstId = body1.results[0].server_id

    const res2 = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l2', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'sakit' } }]
      })
    }, testEnv())
    const body2 = await res2.json() as { results: Array<{ status: string; server_id?: string; server_version?: number }> }

    expect(body2.results[0].status).toBe('synced')
    expect(body2.results[0].server_id).toBe(firstId)
    expect(body2.results[0].server_version).toBe(2)

    const count = await testEnv().DB.prepare('SELECT COUNT(*) as n FROM absensi WHERE santri_id = ?').bind(santriId).first<{ n: number }>()
    expect(count?.n).toBe(1)

    const row = await testEnv().DB.prepare('SELECT status FROM absensi WHERE id = ?').bind(firstId).first<{ status: string }>()
    expect(row?.status).toBe('sakit')
  })

  it('ustadz di luar kamar santri ditolak KAMAR_NOT_ASSIGNED', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'hadir' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('KAMAR_NOT_ASSIGNED')

    const count = await testEnv().DB.prepare('SELECT COUNT(*) as n FROM absensi WHERE santri_id = ?').bind(santriId).first<{ n: number }>()
    expect(count?.n).toBe(0)
  })

  it('kegiatan_id yang tidak ada/tidak aktif ditolak KEGIATAN_NOT_FOUND', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'hadir', kegiatan_id: uuid() } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('KEGIATAN_NOT_FOUND')
  })
})

describe('sync.ts — absensi push update (version guard sama seperti entity lain)', () => {
  it('update dengan version basi disimpan sebagai pending conflict', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const createRes = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'hadir' } }]
      })
    }, testEnv())
    const createBody = await createRes.json() as { results: Array<{ server_id?: string }> }
    const absensiId = createBody.results[0].server_id

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l2', action: 'update', version: 0, data: { id: absensiId, status: 'alpa' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('conflict')

    const stored = await testEnv().DB.prepare(
      "SELECT entity_type FROM sync_conflicts WHERE entity_id = ? AND status = 'pending'"
    ).bind(absensiId).first<{ entity_type: string }>()
    expect(stored?.entity_type).toBe('absensi')
  })

  it('update dengan version benar berhasil synced', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const createRes = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l1', action: 'create', version: 0, data: { santri_id: santriId, tanggal: '2026-07-01', status: 'hadir' } }]
      })
    }, testEnv())
    const createBody = await createRes.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const absensiId = createBody.results[0].server_id
    const v = createBody.results[0].server_version!

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l2', action: 'update', version: v, data: { id: absensiId, status: 'izin' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT status FROM absensi WHERE id = ?').bind(absensiId).first<{ status: string }>()
    expect(row?.status).toBe('izin')
  })
})

describe('sync.ts — absensi belum mendukung action delete lewat sync (belum ada endpoint hapus)', () => {
  it('push action delete ditolak ACTION_NOT_SUPPORTED', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'absensi', local_id: 'l1', action: 'delete', version: 1, data: { id: uuid(), santri_id: santriId } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('ACTION_NOT_SUPPORTED')
  })
})

describe('sync.ts — absensi GET /pull scoping (kamar murni, tanpa kelas)', () => {
  it('ustadz kamar-only dapet absensi santri di kamarnya lewat pull', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    await testEnv().DB.prepare(
      `INSERT INTO absensi (id, santri_id, tanggal, status, dicatat_oleh, version) VALUES (?, ?, '2026-07-01', 'hadir', ?, 1)`
    ).bind(uuid(), santriId, ustadz.id).run()

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { changes: { absensi: unknown[] } }
    expect(body.changes.absensi.length).toBe(1)
  })

  it('ustadz kamar lain TIDAK dapet absensi di kamar yang bukan miliknya', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })
    const otherUstadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarOther] })

    await testEnv().DB.prepare(
      `INSERT INTO absensi (id, santri_id, tanggal, status, dicatat_oleh, version) VALUES (?, ?, '2026-07-01', 'hadir', ?, 1)`
    ).bind(uuid(), santriId, otherUstadz.id).run()

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { absensi: unknown[] } }
    expect(body.changes.absensi.length).toBe(0)
  })
})
