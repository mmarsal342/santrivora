import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv, uuid } from '../../../test/helpers'

// Fase 6 offline-first (paling kompleks): perizinan_pulang. Sesuai keputusan
// user, SEMUA alur termasuk approve/tolak/kembali offline-capable lewat
// mekanisme TransitionRule (dikirim sebagai action:'update' biasa dengan
// data:{status:<target>}), bukan endpoint action terpisah.

async function ajukanSync(token: string, santriId: string, overrides: Partial<{ tanggal_keluar: string; perkiraan_kembali: string; alasan: string }> = {}) {
  return syncRoutes.request('/', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      items: [{
        entity_type: 'perizinan_pulang', local_id: 'l1', action: 'create', version: 0,
        data: {
          santri_id: santriId,
          tanggal_keluar: overrides.tanggal_keluar ?? '2026-08-01',
          perkiraan_kembali: overrides.perkiraan_kembali,
          alasan: overrides.alasan ?? 'Acara keluarga'
        }
      }]
    })
  }, testEnv())
}

describe('sync.ts — perizinan_pulang push create (ajukan)', () => {
  it('ustadz wali kamar bisa ajukan lewat sync', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const res = await ajukanSync(ustadz.accessToken, santri)
    const body = await res.json() as { results: Array<{ status: string; server_id?: string }> }
    expect(body.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT status, diajukan_oleh FROM perizinan_pulang WHERE id = ?').bind(body.results[0].server_id).first<{ status: string; diajukan_oleh: string }>()
    expect(row?.status).toBe('diajukan')
    expect(row?.diajukan_oleh).toBe(ustadz.id)
  })

  it('perkiraan_kembali sebelum tanggal_keluar ditolak di level schema', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const res = await ajukanSync(admin.accessToken, santri, { tanggal_keluar: '2026-08-10', perkiraan_kembali: '2026-08-01' })
    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toContain('INVALID_DATA')
  })

  it('kyai (read-only) tidak bisa ajukan lewat sync', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const kyai = await seedUser({ role: 'kyai' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const res = await ajukanSync(kyai.accessToken, santri)
    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('READ_ONLY_ROLE')
  })
})

describe('sync.ts — perizinan_pulang edit biasa (cuma selama diajukan)', () => {
  it('bisa diedit selama diajukan', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri)
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'perizinan_pulang', local_id: 'l2', action: 'update', version: v, data: { id, alasan: 'Diubah' } }]
      })
    }, testEnv())
    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')
  })

  it('TIDAK bisa diedit lagi setelah disetujui (editGuard NOT_DIAJUKAN)', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri)
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'perizinan_pulang', local_id: 'l2', action: 'update', version: v, data: { id, status: 'disetujui' } }]
      })
    }, testEnv())

    const editAfter = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'perizinan_pulang', local_id: 'l3', action: 'update', version: v + 1, data: { id, alasan: 'Diubah lagi' } }]
      })
    }, testEnv())
    const editAfterBody = await editAfter.json() as { results: Array<{ status: string; error?: string }> }
    expect(editAfterBody.results[0].status).toBe('error')
    expect(editAfterBody.results[0].error).toBe('NOT_DIAJUKAN')
  })

  it('edit yang bikin perkiraan_kembali sebelum tanggal_keluar ditolak TANGGAL_KEMBALI_INVALID', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri, { tanggal_keluar: '2026-08-10' })
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'perizinan_pulang', local_id: 'l2', action: 'update', version: v, data: { id, perkiraan_kembali: '2026-08-01' } }]
      })
    }, testEnv())
    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('TANGGAL_KEMBALI_INVALID')
  })
})

describe('sync.ts — perizinan_pulang transisi approve/tolak (TransitionRule)', () => {
  it('admin approve lewat sync (update status=disetujui)', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri)
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'perizinan_pulang', local_id: 'l2', action: 'update', version: v, data: { id, status: 'disetujui', catatan_keputusan: 'Oke' } }]
      })
    }, testEnv())
    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT status, disetujui_oleh FROM perizinan_pulang WHERE id = ?').bind(id).first<{ status: string; disetujui_oleh: string }>()
    expect(row?.status).toBe('disetujui')
    expect(row?.disetujui_oleh).toBe(admin.id)
  })

  it('ustadz (yang mengajukan) TIDAK bisa approve pengajuannya sendiri lewat sync (approvalScopeCheck)', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(ustadz.accessToken, santri)
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'perizinan_pulang', local_id: 'l2', action: 'update', version: v, data: { id, status: 'disetujui' } }]
      })
    }, testEnv())
    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('NOT_ASSIGNED')
  })

  it('tolak tanpa catatan_keputusan ditolak CATATAN_KEPUTUSAN_REQUIRED', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri)
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'perizinan_pulang', local_id: 'l2', action: 'update', version: v, data: { id, status: 'ditolak' } }]
      })
    }, testEnv())
    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('CATATAN_KEPUTUSAN_REQUIRED')
  })

  it('race sungguhan approve vs tolak (Promise.all) — tepat 1 sukses, yang lain conflict/error', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const kepala = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'L' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri)
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    const [resA, resB] = await Promise.all([
      syncRoutes.request('/', {
        method: 'POST', headers: authHeaders(admin.accessToken),
        body: JSON.stringify({ items: [{ entity_type: 'perizinan_pulang', local_id: 'a', action: 'update', version: v, data: { id, status: 'disetujui' } }] })
      }, testEnv()),
      syncRoutes.request('/', {
        method: 'POST', headers: authHeaders(kepala.accessToken),
        body: JSON.stringify({ items: [{ entity_type: 'perizinan_pulang', local_id: 'b', action: 'update', version: v, data: { id, status: 'ditolak', catatan_keputusan: 'race' } }] })
      }, testEnv())
    ])

    const bodyA = await resA.json() as { results: Array<{ status: string }> }
    const bodyB = await resB.json() as { results: Array<{ status: string }> }
    const statuses = [bodyA.results[0].status, bodyB.results[0].status].sort()
    // Tepat satu 'synced', satu lagi 'conflict' (version race tertangkap sync
    // engine generik) — TIDAK BOLEH dua-duanya 'synced'.
    expect(statuses).toEqual(['conflict', 'synced'])

    const row = await testEnv().DB.prepare('SELECT status FROM perizinan_pulang WHERE id = ?').bind(id).first<{ status: string }>()
    expect(['disetujui', 'ditolak']).toContain(row?.status)
  })
})

describe('sync.ts — perizinan_pulang transisi kembali (writeFields + afterWrite catatan_perkembangan)', () => {
  it('kembali menandai selesai dan otomatis tercatat di catatan_perkembangan', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri, { tanggal_keluar: '2026-08-01', alasan: 'Acara keluarga besar' })
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v1 = createdBody.results[0].server_version!

    const approveRes = await syncRoutes.request('/', {
      method: 'POST', headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ items: [{ entity_type: 'perizinan_pulang', local_id: 'a', action: 'update', version: v1, data: { id, status: 'disetujui' } }] })
    }, testEnv())
    const approveBody = await approveRes.json() as { results: Array<{ server_version?: number }> }
    const v2 = approveBody.results[0].server_version!

    const kembaliRes = await syncRoutes.request('/', {
      method: 'POST', headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ items: [{ entity_type: 'perizinan_pulang', local_id: 'b', action: 'update', version: v2, data: { id, status: 'selesai', tanggal_kembali_aktual: '2026-08-05' } }] })
    }, testEnv())
    const kembaliBody = await kembaliRes.json() as { results: Array<{ status: string }> }
    expect(kembaliBody.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT status, tanggal_kembali_aktual FROM perizinan_pulang WHERE id = ?').bind(id).first<{ status: string; tanggal_kembali_aktual: string }>()
    expect(row?.status).toBe('selesai')
    expect(row?.tanggal_kembali_aktual).toBe('2026-08-05')

    const catatan = await testEnv().DB.prepare(
      "SELECT * FROM catatan_perkembangan WHERE santri_id = ? AND judul = 'Izin Pulang'"
    ).bind(santri).first<{ kategori: string; catatan: string; dicatat_oleh: string }>()
    expect(catatan).toBeTruthy()
    expect(catatan?.kategori).toBe('Keluarga')
    expect(catatan?.catatan).toContain('Acara keluarga besar')
    expect(catatan?.dicatat_oleh).toBe(admin.id)
  })

  it('kembali sebelum disetujui ditolak NOT_DISETUJUI', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri)
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    const res = await syncRoutes.request('/', {
      method: 'POST', headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ items: [{ entity_type: 'perizinan_pulang', local_id: 'a', action: 'update', version: v, data: { id, status: 'selesai', tanggal_kembali_aktual: '2026-08-05' } }] })
    }, testEnv())
    const body = await res.json() as { results: Array<{ status: string; error?: string }> }
    expect(body.results[0].status).toBe('error')
    expect(body.results[0].error).toBe('NOT_DISETUJUI')
  })
})

describe('sync.ts — perizinan_pulang push delete (batalkan, soft-delete)', () => {
  it('batalkan cuma bisa selama diajukan, dan soft-delete (tombstone)', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const admin = await seedUser({ role: 'admin' })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })

    const created = await ajukanSync(admin.accessToken, santri)
    const createdBody = await created.json() as { results: Array<{ server_id?: string; server_version?: number }> }
    const id = createdBody.results[0].server_id
    const v = createdBody.results[0].server_version!

    const res = await syncRoutes.request('/', {
      method: 'POST', headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ items: [{ entity_type: 'perizinan_pulang', local_id: 'a', action: 'delete', version: v, data: { id, santri_id: santri } }] })
    }, testEnv())
    const body = await res.json() as { results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('synced')

    const row = await testEnv().DB.prepare('SELECT is_deleted FROM perizinan_pulang WHERE id = ?').bind(id).first<{ is_deleted: number }>()
    expect(row?.is_deleted).toBe(1)
  })
})

describe('sync.ts — perizinan_pulang GET /pull scoping (via-santri, mirror assertAccess)', () => {
  it('ustadz kamar-only dapet perizinan santri di kamarnya', async () => {
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const santri = await seedSantri({ jenis_kelamin: 'L', kamar_id: kamar })
    const admin = await seedUser({ role: 'admin' })

    await testEnv().DB.prepare(
      "INSERT INTO perizinan_pulang (id, santri_id, tanggal_keluar, alasan, diajukan_oleh, version) VALUES (?, ?, '2026-08-01', 'x', ?, 1)"
    ).bind(uuid(), santri, admin.id).run()

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { perizinan_pulang: unknown[] } }
    expect(body.changes.perizinan_pulang.length).toBe(1)
  })
})
