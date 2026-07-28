import { describe, expect, it } from 'vitest'
import { kamarRoutes } from '../kamar'
import { authHeaders, seedKamar, seedUser, testEnv } from '../../../test/helpers'

describe('kamar.ts — GET / filter status (bug: kamar yang "dihapus" tidak pernah hilang dari daftar)', () => {
  it('default (tanpa status param) cuma nampilin kamar aktif', async () => {
    const admin = await seedUser({ role: 'admin' })
    const aktif = await seedKamar({ nama: 'Kamar Aktif Test' })
    const nonaktif = await seedKamar({ nama: 'Kamar Nonaktif Test' })
    await testEnv().DB.prepare('UPDATE kamar SET is_active = 0 WHERE id = ?').bind(nonaktif).run()

    const res = await kamarRoutes.request('/', { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res.json() as { data: Array<{ id: string }> }
    const ids = body.data.map((k) => k.id)
    expect(ids).toContain(aktif)
    expect(ids).not.toContain(nonaktif)
  })

  it('status=nonaktif cuma nampilin yang sudah dinonaktifkan', async () => {
    const admin = await seedUser({ role: 'admin' })
    const aktif = await seedKamar({ nama: 'Kamar Aktif Test 2' })
    const nonaktif = await seedKamar({ nama: 'Kamar Nonaktif Test 2' })
    await testEnv().DB.prepare('UPDATE kamar SET is_active = 0 WHERE id = ?').bind(nonaktif).run()

    const res = await kamarRoutes.request('/?status=nonaktif', { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res.json() as { data: Array<{ id: string }> }
    const ids = body.data.map((k) => k.id)
    expect(ids).toContain(nonaktif)
    expect(ids).not.toContain(aktif)
  })

  it('status=semua nampilin dua-duanya', async () => {
    const admin = await seedUser({ role: 'admin' })
    const aktif = await seedKamar({ nama: 'Kamar Aktif Test 3' })
    const nonaktif = await seedKamar({ nama: 'Kamar Nonaktif Test 3' })
    await testEnv().DB.prepare('UPDATE kamar SET is_active = 0 WHERE id = ?').bind(nonaktif).run()

    const res = await kamarRoutes.request('/?status=semua', { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res.json() as { data: Array<{ id: string }> }
    const ids = body.data.map((k) => k.id)
    expect(ids).toContain(aktif)
    expect(ids).toContain(nonaktif)
  })

  it('DELETE /api/kamar/:id (nonaktifkan) langsung bikin kamar itu hilang dari daftar default', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamar = await seedKamar({ nama: 'Kamar Buat Dihapus' })

    const del = await kamarRoutes.request(`/${kamar}`, { method: 'DELETE', headers: authHeaders(admin.accessToken) }, testEnv())
    expect(del.status).toBe(200)

    const res = await kamarRoutes.request('/', { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res.json() as { data: Array<{ id: string }> }
    expect(body.data.map((k) => k.id)).not.toContain(kamar)
  })

  it('kepala_asrama juga cuma lihat kamar aktif di asramanya secara default', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kepala = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'L' })
    const aktif = await seedKamar({ nama: 'Kamar Aktif Asrama', jenis_kelamin: 'L' })
    const nonaktif = await seedKamar({ nama: 'Kamar Nonaktif Asrama', jenis_kelamin: 'L' })
    await testEnv().DB.prepare('UPDATE kamar SET is_active = 0 WHERE id = ?').bind(nonaktif).run()

    const res = await kamarRoutes.request('/', { headers: authHeaders(kepala.accessToken) }, testEnv())
    const body = await res.json() as { data: Array<{ id: string }> }
    const ids = body.data.map((k) => k.id)
    expect(ids).toContain(aktif)
    expect(ids).not.toContain(nonaktif)
  })
})
