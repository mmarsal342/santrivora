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

// Ditemukan saat re-check fix di atas (bukan temuan audit awal): validasi kategori_id
// yang baru ditambahkan cek `item.data.tipe` (dari client), padahal `tipe` bukan field
// yang bisa diupdate — jadi klien yang cukup tidak mengirim `tipe` (kasus normal:
// cuma kirim field yang berubah) melewati validasi sepenuhnya walau baris di DB-nya
// tetap tipe='pelanggaran'.
describe('sync.ts — kategori_id di update catatan_disiplin divalidasi dari tipe DB, bukan dari client', () => {
  it('update kategori_id ke ID acak ditolak walau item.data TIDAK menyertakan field tipe', async () => {
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
          version: 1,
          data: { id: catatanId, kategori_id: uuid() } // tipe TIDAK disertakan, seperti klien normal
        }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('KATEGORI_NOT_FOUND')

    const row = await testEnv().DB.prepare('SELECT kategori_id FROM catatan_disiplin WHERE id = ?').bind(catatanId).first<{ kategori_id: string | null }>()
    expect(row?.kategori_id).toBeNull()
  })

  it('update kategori_id yang valid tetap berhasil', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const kategoriId = uuid()
    await testEnv().DB.prepare(
      "INSERT INTO kategori_pelanggaran (id, nama) VALUES (?, 'Terlambat')"
    ).bind(kategoriId).run()

    const catatanId = uuid()
    await testEnv().DB.prepare(
      `INSERT INTO catatan_disiplin (id, santri_id, tipe, judul, tanggal_kejadian, dicatat_oleh, version)
       VALUES (?, ?, 'pelanggaran', 'Judul awal', '2026-01-01', ?, 1)`
    ).bind(catatanId, santriId, ustadz.id).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'catatan_disiplin', local_id: 'l1', action: 'update', version: 1, data: { id: catatanId, kategori_id: kategoriId } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')
  })
})

// Ditemukan saat re-check: cabang "race" yang baru ditambahkan (persist conflict saat
// UPDATE ... WHERE version = ? kena 0 rows) ternyata juga kena kalau klien kirim
// version yang LEBIH BESAR dari version server (bukan cuma race asli) — itu bisa
// dipakai flood tabel sync_conflicts dengan conflict palsu berkali-kali dari request
// yang sama-sama valid secara scope.
describe('sync.ts — version yang mustahil (lebih besar dari server) ditolak, bukan bikin conflict', () => {
  it('push dengan version > version server ditolak error INVALID_VERSION, tidak menambah sync_conflicts', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    for (let i = 0; i < 3; i++) {
      const res = await syncRoutes.request('/', {
        method: 'POST',
        headers: authHeaders(ustadz.accessToken),
        body: JSON.stringify({
          items: [{ entity_type: 'santri', local_id: `l${i}`, action: 'update', version: 999, data: { id: santriId, nama_lengkap: 'X' } }]
        })
      }, testEnv())
      const body = await res.json() as { results: Array<{ status: string; error?: string }> }
      expect(body.results[0].status).toBe('error')
      expect(body.results[0].error).toBe('INVALID_VERSION')
    }

    const conflicts = await testEnv().DB.prepare(
      'SELECT COUNT(*) as n FROM sync_conflicts WHERE entity_id = ?'
    ).bind(santriId).first<{ n: number }>()
    expect(conflicts?.n).toBe(0)
  })
})

// Ditemukan saat re-check: validasi kelas/kamar yang ditambahkan sebelumnya berjalan
// unconditional terhadap NILAI EFEKTIF (fallback ke current kalau tidak diubah), jadi
// begitu kamar/kelas yang ditempati seorang santri dinonaktifkan, SEMUA edit lain ke
// santri itu (bahkan yang tidak menyentuh kamar/kelas sama sekali) ikut ditolak — dan
// conflict yang sudah ada jadi tidak bisa diresolve sama sekali, termasuk 'use_server'
// yang seharusnya no-op.
describe('sync.ts — edit yang tidak menyentuh kamar/kelas tidak boleh diblokir gara-gara kamar/kelas itu belakangan dinonaktifkan', () => {
  it('push update nama_lengkap tetap berhasil walau kamar santri sudah dinonaktifkan', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const admin = await seedUser({ role: 'admin' })

    await testEnv().DB.prepare('UPDATE kamar SET is_active = 0 WHERE id = ?').bind(kamar).run()

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'santri', local_id: 'l1', action: 'update', version: 1, data: { id: santriId, nama_lengkap: 'Nama Baru' } }]
      })
    }, testEnv())

    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('synced')
  })

  it("resolve 'use_server' (no-op) tetap berhasil walau kamar santri sudah dinonaktifkan", async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const admin = await seedUser({ role: 'admin' })

    // Bikin conflict yang sah dulu (sebelum kamar dinonaktifkan).
    const pushRes = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'santri', local_id: 'l1', action: 'update', version: 0, data: { id: santriId, nama_lengkap: 'X' } }]
      })
    }, testEnv())
    const pushBody = await pushRes.json() as { results: Array<{ status: string }> }
    expect(pushBody.results[0].status).toBe('conflict')

    await testEnv().DB.prepare('UPDATE kamar SET is_active = 0 WHERE id = ?').bind(kamar).run()

    const conflict = await testEnv().DB.prepare(
      "SELECT id FROM sync_conflicts WHERE entity_id = ? AND status = 'pending'"
    ).bind(santriId).first<{ id: string }>()

    const resolveRes = await syncRoutes.request(`/conflicts/${conflict!.id}/resolve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ resolution: 'use_server' })
    }, testEnv())

    expect(resolveRes.status).toBe(200)
  })
})

// Ditemukan saat re-check: apply resolve nge-SET version = server_version + 1 secara
// absolut tanpa guard WHERE version — kalau baris sudah maju lagi setelah conflict
// tercatat, angka version bisa MUNDUR dan optimistic-locking jadi rusak.
describe('sync.ts — resolve conflict tidak boleh mundurin version kalau row sudah berubah lagi', () => {
  it('resolve santri conflict yang sudah stale (row berubah lagi setelah conflict tercatat) ditolak 409, tidak menimpa data', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar, nama_lengkap: 'Awal' })
    const admin = await seedUser({ role: 'admin' })

    const pushRes = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'santri', local_id: 'l1', action: 'update', version: 0, data: { id: santriId, nama_lengkap: 'Dari client' } }]
      })
    }, testEnv())
    const pushBody = await pushRes.json() as { results: Array<{ status: string }> }
    expect(pushBody.results[0].status).toBe('conflict')

    const conflict = await testEnv().DB.prepare(
      "SELECT id, server_version FROM sync_conflicts WHERE entity_id = ? AND status = 'pending'"
    ).bind(santriId).first<{ id: string; server_version: number }>()
    expect(conflict).toBeTruthy()

    // Row maju lagi (edit lain, di luar flow resolve ini) setelah conflict tercatat.
    await testEnv().DB.prepare(
      "UPDATE santri SET nama_lengkap = 'Edit belakangan', version = version + 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(santriId).run()
    const advanced = await testEnv().DB.prepare('SELECT version FROM santri WHERE id = ?').bind(santriId).first<{ version: number }>()
    expect(advanced!.version).toBeGreaterThan(conflict!.server_version)

    const resolveRes = await syncRoutes.request(`/conflicts/${conflict!.id}/resolve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ resolution: 'use_server' })
    }, testEnv())

    expect(resolveRes.status).toBe(409)

    const row = await testEnv().DB.prepare('SELECT nama_lengkap, version FROM santri WHERE id = ?').bind(santriId).first<{ nama_lengkap: string; version: number }>()
    expect(row?.nama_lengkap).toBe('Edit belakangan')
    expect(row?.version).toBe(advanced!.version)
  })
})
