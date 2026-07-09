import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv, uuid } from '../../../test/helpers'

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

// Regresi audit HIGH #1: conflict-resolution dulu bisa dipakai bypass scope/gender
// check yang selalu ditegakkan di jalur create/update biasa (IDOR/privilege escalation).
describe('sync.ts — conflict-resolution tidak boleh bypass scope (audit HIGH #1)', () => {
  it('push dengan version basi + kamar_id di luar scope ditolak sebagai error, BUKAN disimpan sebagai conflict', async () => {
    const kamarMine = await seedKamar({ jenis_kelamin: 'L' })
    const kamarOther = await seedKamar({ jenis_kelamin: 'L' })
    const santriId = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamarMine })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{
          entity_type: 'santri',
          local_id: 'l1',
          action: 'update',
          version: 0, // stale (santri version default = 1) — sengaja memicu jalur conflict
          data: { id: santriId, kamar_id: kamarOther }
        }]
      })
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('KAMAR_NOT_ASSIGNED')

    const pending = await testEnv().DB.prepare(
      "SELECT id FROM sync_conflicts WHERE entity_id = ? AND status = 'pending'"
    ).bind(santriId).all()
    expect(pending.results?.length ?? 0).toBe(0)
  })

  it('resolve manual_merge dengan kamar_id di luar scope ditolak, tidak diterapkan ke DB', async () => {
    const kamarMine = await seedKamar({ jenis_kelamin: 'L' })
    const kamarOther = await seedKamar({ jenis_kelamin: 'L' })
    const santriId = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamarMine })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    // Bikin conflict yang sah (kamar_id tidak diubah, cuma nama — jadi lolos validasi
    // target-scope di push dan benar-benar tersimpan sebagai conflict pending).
    const pushRes = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{
          entity_type: 'santri',
          local_id: 'l1',
          action: 'update',
          version: 0,
          data: { id: santriId, nama_lengkap: 'Nama Baru' }
        }]
      })
    }, testEnv())
    const pushBody = await pushRes.json() as { results: Array<{ status: string }> }
    expect(pushBody.results[0].status).toBe('conflict')

    const conflict = await testEnv().DB.prepare(
      "SELECT id FROM sync_conflicts WHERE entity_id = ? AND status = 'pending'"
    ).bind(santriId).first<{ id: string }>()
    expect(conflict).toBeTruthy()

    // Exploit attempt: manual_merge memindahkan santri ke kamar di luar scope ustadz ini.
    const resolveRes = await syncRoutes.request(`/conflicts/${conflict!.id}/resolve`, {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({ resolution: 'manual_merge', merged_data: { kamar_id: kamarOther } })
    }, testEnv())

    expect(resolveRes.status).toBe(403)
    const resolveBody = await resolveRes.json() as { code: string }
    expect(resolveBody.code).toBe('KAMAR_NOT_ASSIGNED')

    const santriRow = await testEnv().DB.prepare('SELECT kamar_id FROM santri WHERE id = ?').bind(santriId).first<{ kamar_id: string }>()
    expect(santriRow?.kamar_id).toBe(kamarMine)
  })

  it('resolve dengan resolution tidak valid ditolak 400 (bukan silent no-op yang menandai resolved)', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'santri', local_id: 'l1', action: 'update', version: 0, data: { id: santriId, nama_lengkap: 'X' } }]
      })
    }, testEnv())
    const conflict = await testEnv().DB.prepare(
      "SELECT id FROM sync_conflicts WHERE entity_id = ? AND status = 'pending'"
    ).bind(santriId).first<{ id: string }>()

    const res = await syncRoutes.request(`/conflicts/${conflict!.id}/resolve`, {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({ resolution: 'bogus' })
    }, testEnv())

    expect(res.status).toBe(400)
    const stillPending = await testEnv().DB.prepare(
      "SELECT status FROM sync_conflicts WHERE id = ?"
    ).bind(conflict!.id).first<{ status: string }>()
    expect(stillPending?.status).toBe('pending')
  })
})

// Regresi audit HIGH #2: conflict untuk catatan_disiplin dulu tidak pernah disimpan
// ke sync_conflicts (beda dengan santri) — hilang selamanya kalau client tidak sempat
// menerima response HTTP-nya.
describe('sync.ts — catatan_disiplin conflict tersimpan ke sync_conflicts (audit HIGH #2)', () => {
  it('update catatan_disiplin dengan version basi disimpan sebagai pending conflict', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const catatanId = uuid()
    await testEnv().DB.prepare(
      `INSERT INTO catatan_disiplin (id, santri_id, tipe, judul, tanggal_kejadian, dicatat_oleh, version)
       VALUES (?, ?, 'pelanggaran', 'Judul awal', '2026-01-01', ?, 1)`
    ).bind(catatanId, santriId, ustadz.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{
          entity_type: 'catatan_disiplin',
          local_id: 'l1',
          action: 'update',
          version: 0, // stale (current version = 1)
          data: { id: catatanId, judul: 'Judul revisi client' }
        }]
      })
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('conflict')

    const stored = await testEnv().DB.prepare(
      "SELECT entity_type, entity_id, status FROM sync_conflicts WHERE entity_id = ?"
    ).bind(catatanId).first<{ entity_type: string; entity_id: string; status: string }>()
    expect(stored).toBeTruthy()
    expect(stored?.entity_type).toBe('catatan_disiplin')
    expect(stored?.status).toBe('pending')
  })
})
