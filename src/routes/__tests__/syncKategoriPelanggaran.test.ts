import { describe, expect, it } from 'vitest'
import { syncRoutes } from '../sync'
import { authHeaders, seedKategoriPelanggaran, seedUser, testEnv } from '../../../test/helpers'

// Fase 22 offline-first (gelombang 1 frontend) — kategori_pelanggaran
// kelewat di rollout awal (seharusnya dipasangkan bareng kelas/kamar di
// migrasi 014), ditambahkan sekarang karena dibutuhkan KategoriListView +
// dropdown kategori di CatatanFormView. Pull-only, scope 'global' — TIDAK
// ada filter role sama sekali (mirror kategori.ts GET /, semua role login
// lihat semua kategori; cuma admin yang boleh tulis, lewat REST langsung).

describe('sync.ts — kategori_pelanggaran TIDAK bisa di-push (pull-only)', () => {
  it('push entity_type kategori_pelanggaran ditolak validasi', async () => {
    const admin = await seedUser({ role: 'admin' })

    const res = await syncRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({
        items: [{ entity_type: 'kategori_pelanggaran', local_id: 'l1', action: 'create', version: 0, data: { nama: 'Kategori Baru' } }]
      })
    }, testEnv())

    expect(res.status).toBe(400)
  })
})

describe('sync.ts — kategori_pelanggaran GET /pull (scope global, sama utk semua role)', () => {
  it('admin dapat semua kategori', async () => {
    await seedKategoriPelanggaran()
    await seedKategoriPelanggaran()
    const admin = await seedUser({ role: 'admin' })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(admin.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kategori_pelanggaran: unknown[] } }
    expect(body.changes.kategori_pelanggaran.length).toBe(2)
  })

  it('ustadz TETAP dapat semua kategori (bukan cuma admin/kyai) — beda dari kelas/kamar', async () => {
    await seedKategoriPelanggaran()
    await seedKategoriPelanggaran()
    const ustadz = await seedUser({ role: 'ustadz' })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kategori_pelanggaran: unknown[] } }
    expect(body.changes.kategori_pelanggaran.length).toBe(2)
  })

  it('kepala_asrama JUGA dapat semua kategori (scope global, bukan dibatasi kamar)', async () => {
    await seedKategoriPelanggaran()
    const kepalaAsrama = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'L' })

    const res = await syncRoutes.request('/pull?since=2000-01-01T00:00:00.000Z', {
      headers: authHeaders(kepalaAsrama.accessToken)
    }, testEnv())

    const body = await res.json() as { changes: { kategori_pelanggaran: unknown[] } }
    expect(body.changes.kategori_pelanggaran.length).toBe(1)
  })
})
