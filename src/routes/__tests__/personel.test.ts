import { describe, expect, it } from 'vitest'
import { personelRoutes } from '../personel'
import { authHeaders, seedKamar, seedUser, testEnv } from '../../../test/helpers'

describe('personel.ts — akses terbatas admin & kyai', () => {
  it('ustadz ditolak 403 pada list personel', async () => {
    const ustadz = await seedUser({ role: 'ustadz' })

    const res = await personelRoutes.request('/', {
      headers: authHeaders(ustadz.accessToken)
    }, testEnv())

    expect(res.status).toBe(403)
  })

  it('kepala_asrama ditolak 403 (bukan admin/kyai)', async () => {
    const kepala = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'L' })

    const res = await personelRoutes.request('/', {
      headers: authHeaders(kepala.accessToken)
    }, testEnv())

    expect(res.status).toBe(403)
  })

  it('admin & kyai bisa list personel dengan penugasan kelas/kamar', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kyai = await seedUser({ role: 'kyai' })
    const kamar = await seedKamar({ nama: 'Kamar Asy-Syifa' })
    await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    for (const actor of [admin, kyai]) {
      const res = await personelRoutes.request('/', {
        headers: authHeaders(actor.accessToken)
      }, testEnv())
      expect(res.status).toBe(200)
      const body = await res.json() as { data: Array<{ assigned_kamar: Array<{ nama: string }> }> }
      const withKamar = body.data.find((u) => u.assigned_kamar.some((k) => k.nama === 'Kamar Asy-Syifa'))
      expect(withKamar).toBeTruthy()
    }
  })
})

describe('personel.ts — GET /:id profil + ringkasan aktivitas', () => {
  it('profil berisi identitas, penugasan, dan hitungan aktivitas', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamar = await seedKamar()
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await personelRoutes.request(`/${ustadz.id}`, {
      headers: authHeaders(admin.accessToken)
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { data: { id: string; assigned_kamar: unknown[]; aktivitas: Record<string, number> } }
    expect(body.data.id).toBe(ustadz.id)
    expect(body.data.assigned_kamar.length).toBe(1)
    expect(body.data.aktivitas.catatan_disiplin_dicatat).toBe(0)
  })

  it('personel yang tidak ada 404', async () => {
    const admin = await seedUser({ role: 'admin' })

    const res = await personelRoutes.request('/00000000-0000-0000-0000-000000000000', {
      headers: authHeaders(admin.accessToken)
    }, testEnv())

    expect(res.status).toBe(404)
  })
})

describe('personel.ts — CRUD catatan personel', () => {
  it('admin & kyai bisa membuat catatan personel (beda dari requireCanMutate, kyai TIDAK ditolak)', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kyai = await seedUser({ role: 'kyai' })
    const ustadz = await seedUser({ role: 'ustadz' })

    const resAdmin = await personelRoutes.request(`/${ustadz.id}/catatan`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ tanggal: '2026-07-01', kategori: 'Kinerja', judul: 'Rajin hadir', catatan: 'Konsisten tepat waktu.' })
    }, testEnv())
    expect(resAdmin.status).toBe(201)

    const resKyai = await personelRoutes.request(`/${ustadz.id}/catatan`, {
      method: 'POST',
      headers: authHeaders(kyai.accessToken),
      body: JSON.stringify({ tanggal: '2026-07-02', kategori: 'Keputusan Kyai', judul: 'Naik jadi wali kamar baru' })
    }, testEnv())
    expect(resKyai.status).toBe(201)

    const list = await personelRoutes.request(`/${ustadz.id}/catatan`, {
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    const listBody = await list.json() as { data: Array<{ judul: string; dicatat_oleh_nama: string }> }
    expect(listBody.data.length).toBe(2)
  })

  it('kategori di luar enum ditolak 400', async () => {
    const admin = await seedUser({ role: 'admin' })
    const ustadz = await seedUser({ role: 'ustadz' })

    const res = await personelRoutes.request(`/${ustadz.id}/catatan`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ tanggal: '2026-07-01', kategori: 'Tidak Valid', judul: 'x' })
    }, testEnv())

    expect(res.status).toBe(400)
  })

  it('catatan ke personel yang tidak ada 404', async () => {
    const admin = await seedUser({ role: 'admin' })

    const res = await personelRoutes.request('/00000000-0000-0000-0000-000000000000/catatan', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ tanggal: '2026-07-01', kategori: 'Kinerja', judul: 'x' })
    }, testEnv())

    expect(res.status).toBe(404)
  })

  it('update & soft-delete catatan personel', async () => {
    const admin = await seedUser({ role: 'admin' })
    const ustadz = await seedUser({ role: 'ustadz' })

    const create = await personelRoutes.request(`/${ustadz.id}/catatan`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ tanggal: '2026-07-01', kategori: 'Kinerja', judul: 'Awal' })
    }, testEnv())
    const created = await create.json() as { data: { id: string } }

    const update = await personelRoutes.request(`/catatan/${created.data.id}`, {
      method: 'PUT',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ judul: 'Diperbarui' })
    }, testEnv())
    expect(update.status).toBe(200)
    const updated = await update.json() as { data: { judul: string } }
    expect(updated.data.judul).toBe('Diperbarui')

    const del = await personelRoutes.request(`/catatan/${created.data.id}`, {
      method: 'DELETE',
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    expect(del.status).toBe(200)

    const list = await personelRoutes.request(`/${ustadz.id}/catatan`, {
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    const listBody = await list.json() as { data: unknown[] }
    expect(listBody.data.length).toBe(0)
  })
})
