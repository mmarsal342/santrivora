import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKamar, seedKelas, seedUser, testEnv, uuid } from '../../../test/helpers'

// Fase 2 offline-first: entity `kegiatan` (creator-override + writeScope beda
// dari read scope) dan `jadwal_kegiatan` (baca global, tulis admin-only).

describe('sync.ts — kegiatan push create', () => {
  it('non-admin tanpa kelas_id/kamar_id ditolak SCOPE_REQUIRED', async () => {
    const ustadz = await seedUser({ role: 'ustadz' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kegiatan', local_id: 'l1', action: 'create', version: 0, data: { nama: 'Ngaji', tanggal: '2026-07-01' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('SCOPE_REQUIRED')
  })

  it('ustadz bikin kegiatan untuk kelasnya sendiri berhasil', async () => {
    const kelas = await seedKelas()
    const ustadz = await seedUser({ role: 'ustadz', kelas_ids: [kelas] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kegiatan', local_id: 'l1', action: 'create', version: 0, data: { nama: 'Ngaji', tanggal: '2026-07-01', kelas_id: kelas } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; server_id?: string }> }
    expect(body.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT created_by FROM kegiatan WHERE id = ?').bind(body.results[0].server_id).first<{ created_by: string }>()
    expect(row?.created_by).toBe(ustadz.id)
  })

  it('ustadz bikin kegiatan untuk kelas orang lain ditolak KELAS_NOT_ASSIGNED', async () => {
    const kelasMine = await seedKelas()
    const kelasOther = await seedKelas()
    const ustadz = await seedUser({ role: 'ustadz', kelas_ids: [kelasMine] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kegiatan', local_id: 'l1', action: 'create', version: 0, data: { nama: 'Ngaji', tanggal: '2026-07-01', kelas_id: kelasOther } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('KELAS_NOT_ASSIGNED')
  })
})

describe('sync.ts — kegiatan push update (creator-override, writeScope beda dari read scope)', () => {
  it('pembuat (ustadz) yang masih pegang kamarnya bisa update', async () => {
    const kamar = await seedKamar()
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const kegiatanId = uuid()
    await testEnv().DB.prepare(
      "INSERT INTO kegiatan (id, nama, tanggal, kamar_id, created_by, version) VALUES (?, 'Olahraga', '2026-07-01', ?, ?, 1)"
    ).bind(kegiatanId, kamar, ustadz.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kegiatan', local_id: 'l1', action: 'update', version: 1, data: { id: kegiatanId, nama: 'Olahraga Pagi' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')
  })

  it('pembuat yang SUDAH TIDAK pegang kamarnya lagi TIDAK bisa update (kelas/kamar sudah di luar scope)', async () => {
    const kamar = await seedKamar()
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [] }) // sudah tidak pegang kamar itu
    const kegiatanId = uuid()
    await testEnv().DB.prepare(
      "INSERT INTO kegiatan (id, nama, tanggal, kamar_id, created_by, version) VALUES (?, 'Olahraga', '2026-07-01', ?, ?, 1)"
    ).bind(kegiatanId, kamar, ustadz.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kegiatan', local_id: 'l1', action: 'update', version: 1, data: { id: kegiatanId, nama: 'Olahraga Pagi' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('INSUFFICIENT_PERMISSIONS')
  })

  it('ustadz LAIN (bukan pembuat) yang punya akses baca TIDAK bisa update', async () => {
    const kamar = await seedKamar()
    const creator = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const otherUstadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const kegiatanId = uuid()
    await testEnv().DB.prepare(
      "INSERT INTO kegiatan (id, nama, tanggal, kamar_id, created_by, version) VALUES (?, 'Olahraga', '2026-07-01', ?, ?, 1)"
    ).bind(kegiatanId, kamar, creator.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(otherUstadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kegiatan', local_id: 'l1', action: 'update', version: 1, data: { id: kegiatanId, nama: 'Olahraga Pagi' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('INSUFFICIENT_PERMISSIONS')
  })

  it('admin selalu bisa update walau bukan pembuat', async () => {
    const kamar = await seedKamar()
    const creator = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const admin = await seedUser({ role: 'admin' })
    const kegiatanId = uuid()
    await testEnv().DB.prepare(
      "INSERT INTO kegiatan (id, nama, tanggal, kamar_id, created_by, version) VALUES (?, 'Olahraga', '2026-07-01', ?, ?, 1)"
    ).bind(kegiatanId, kamar, creator.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kegiatan', local_id: 'l1', action: 'update', version: 1, data: { id: kegiatanId, nama: 'Olahraga Pagi' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')
  })
})

describe('sync.ts — kegiatan GET /pull (read scope lebih longgar dari write)', () => {
  it('ustadz dengan akses kamar bisa pull kegiatan itu walau bukan pembuatnya', async () => {
    const kamar = await seedKamar()
    const creator = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const reader = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    await testEnv().DB.prepare(
      "INSERT INTO kegiatan (id, nama, tanggal, kamar_id, created_by, version) VALUES (?, 'Olahraga', '2026-07-01', ?, ?, 1)"
    ).bind(uuid(), kamar, creator.id).run()

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(reader.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kegiatan: unknown[] } }
    expect(body.changes.kegiatan.length).toBe(1)
  })

  it('kegiatan umum (tanpa kelas/kamar) kelihatan buat semua ustadz', async () => {
    const ustadz = await seedUser({ role: 'ustadz' })
    await testEnv().DB.prepare(
      "INSERT INTO kegiatan (id, nama, tanggal, created_by, version) VALUES (?, 'Apel Pagi', '2026-07-01', ?, 1)"
    ).bind(uuid(), ustadz.id).run()

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kegiatan: unknown[] } }
    expect(body.changes.kegiatan.length).toBe(1)
  })
})

describe('sync.ts — jadwal_kegiatan (baca global, tulis admin-only)', () => {
  it('ustadz TIDAK bisa create jadwal_kegiatan (INSUFFICIENT_PERMISSIONS)', async () => {
    const ustadz = await seedUser({ role: 'ustadz' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'jadwal_kegiatan', local_id: 'l1', action: 'create', version: 0, data: { nama: 'Sholat Subuh' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('INSUFFICIENT_PERMISSIONS')
  })

  it('admin bisa create jadwal_kegiatan', async () => {
    const admin = await seedUser({ role: 'admin' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'jadwal_kegiatan', local_id: 'l1', action: 'create', version: 0, data: { nama: 'Sholat Subuh' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')
  })

  it('ustadz tetap bisa PULL jadwal_kegiatan walau tidak bisa menulis', async () => {
    const admin = await seedUser({ role: 'admin' })
    const ustadz = await seedUser({ role: 'ustadz' })
    await testEnv().DB.prepare(
      "INSERT INTO jadwal_kegiatan (id, nama, created_by, version) VALUES (?, 'Sholat Subuh', ?, 1)"
    ).bind(uuid(), admin.id).run()

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { jadwal_kegiatan: unknown[] } }
    expect(body.changes.jadwal_kegiatan.length).toBe(1)
  })

  it('ustadz TIDAK bisa update jadwal_kegiatan yang ada', async () => {
    const admin = await seedUser({ role: 'admin' })
    const ustadz = await seedUser({ role: 'ustadz' })
    const jadwalId = uuid()
    await testEnv().DB.prepare(
      "INSERT INTO jadwal_kegiatan (id, nama, created_by, version) VALUES (?, 'Sholat Subuh', ?, 1)"
    ).bind(jadwalId, admin.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'jadwal_kegiatan', local_id: 'l1', action: 'update', version: 1, data: { id: jadwalId, nama: 'Sholat Subuh Berjamaah' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('INSUFFICIENT_PERMISSIONS')
  })
})
