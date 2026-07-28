import { describe, expect, it } from 'vitest'
import { santriRoutes } from '../santri'
import { adminRoutes } from '../admin'
import { personelRoutes } from '../personel'
import { authHeaders, seedKamar, seedUser, testEnv } from '../../../test/helpers'

describe('riwayat kamar santri — dicatat lewat santri.ts', () => {
  it('create santri dengan kamar_id langsung buka span riwayat terbuka', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamar = await seedKamar({ jenis_kelamin: 'L' })

    const res = await santriRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ nama_lengkap: 'Santri A', jenis_kelamin: 'L', kamar_id: kamar })
    }, testEnv())
    expect(res.status).toBe(201)
    const body = await res.json() as { data: { id: string } }

    const row = await testEnv().DB.prepare(
      'SELECT kamar_id, selesai_at FROM riwayat_kamar_santri WHERE santri_id = ?'
    ).bind(body.data.id).first<{ kamar_id: string; selesai_at: string | null }>()
    expect(row?.kamar_id).toBe(kamar)
    expect(row?.selesai_at).toBeNull()
  })

  it('pindah kamar via PUT menutup span lama dan membuka span baru', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamarLama = await seedKamar({ jenis_kelamin: 'L' })
    const kamarBaru = await seedKamar({ jenis_kelamin: 'L' })

    const create = await santriRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ nama_lengkap: 'Santri B', jenis_kelamin: 'L', kamar_id: kamarLama })
    }, testEnv())
    const created = await create.json() as { data: { id: string } }

    const update = await santriRoutes.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_id: kamarBaru })
    }, testEnv())
    expect(update.status).toBe(200)

    const rows = await testEnv().DB.prepare(
      'SELECT kamar_id, selesai_at FROM riwayat_kamar_santri WHERE santri_id = ?'
    ).bind(created.data.id).all<{ kamar_id: string; selesai_at: string | null }>()
    expect(rows.results.length).toBe(2)
    const lamaRow = rows.results.find((r) => r.kamar_id === kamarLama)
    const baruRow = rows.results.find((r) => r.kamar_id === kamarBaru)
    expect(lamaRow?.selesai_at).not.toBeNull()
    expect(baruRow?.selesai_at).toBeNull()
  })

  it('santri dikeluarkan (DELETE) menutup span yang masih terbuka', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamar = await seedKamar({ jenis_kelamin: 'P' })

    const create = await santriRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ nama_lengkap: 'Santri C', jenis_kelamin: 'P', kamar_id: kamar })
    }, testEnv())
    const created = await create.json() as { data: { id: string } }

    const del = await santriRoutes.request(`/${created.data.id}`, {
      method: 'DELETE',
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    expect(del.status).toBe(200)

    const row = await testEnv().DB.prepare(
      'SELECT selesai_at FROM riwayat_kamar_santri WHERE santri_id = ?'
    ).bind(created.data.id).first<{ selesai_at: string | null }>()
    expect(row?.selesai_at).not.toBeNull()
  })
})

describe('riwayat kamar personel — dicatat lewat admin.ts approve', () => {
  it('assign wali kamar pertama kali buka span, ganti kamar menutup yang lama', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamarLama = await seedKamar()
    const kamarBaru = await seedKamar()
    const pending = await seedUser({ role: 'ustadz', status: 'pending', kamar_ids: [] })

    await adminRoutes.request(`/users/${pending.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [kamarLama] })
    }, testEnv())

    let rows = await testEnv().DB.prepare(
      'SELECT kamar_id, selesai_at FROM riwayat_kamar_personel WHERE user_id = ?'
    ).bind(pending.id).all<{ kamar_id: string; selesai_at: string | null }>()
    expect(rows.results.length).toBe(1)
    expect(rows.results[0].selesai_at).toBeNull()

    await adminRoutes.request(`/users/${pending.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [kamarBaru] })
    }, testEnv())

    rows = await testEnv().DB.prepare(
      'SELECT kamar_id, selesai_at FROM riwayat_kamar_personel WHERE user_id = ?'
    ).bind(pending.id).all<{ kamar_id: string; selesai_at: string | null }>()
    expect(rows.results.length).toBe(2)
    const lamaRow = rows.results.find((r) => r.kamar_id === kamarLama)
    const baruRow = rows.results.find((r) => r.kamar_id === kamarBaru)
    expect(lamaRow?.selesai_at).not.toBeNull()
    expect(baruRow?.selesai_at).toBeNull()
  })
})

describe('personel.ts — GET /:id/santri-riwayat', () => {
  it('santri yang overlap periode kamar dengan wali kamar muncul di riwayat, ditandai masih_diasuh', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamar = await seedKamar({ jenis_kelamin: 'L' })
    const wali = await seedUser({ role: 'ustadz', status: 'pending', kamar_ids: [] })

    await adminRoutes.request(`/users/${wali.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [kamar] })
    }, testEnv())

    const createSantri = await santriRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ nama_lengkap: 'Santri Diasuh', jenis_kelamin: 'L', kamar_id: kamar })
    }, testEnv())
    const santri = await createSantri.json() as { data: { id: string } }

    const res = await personelRoutes.request(`/${wali.id}/santri-riwayat`, {
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ santri_id: string; masih_diasuh: boolean }> }
    const entry = body.data.find((d) => d.santri_id === santri.data.id)
    expect(entry).toBeTruthy()
    expect(entry?.masih_diasuh).toBe(true)
  })

  it('santri yang pindah ke wali kamar lain sebelum periode overlap TIDAK muncul', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamarA = await seedKamar({ jenis_kelamin: 'L' })
    const kamarB = await seedKamar({ jenis_kelamin: 'L' })
    const waliA = await seedUser({ role: 'ustadz', status: 'pending', kamar_ids: [] })

    // waliA baru pegang kamarB SETELAH santri sudah pindah ke kamarB, jadi
    // tidak pernah tumpang tindih dengan periode santri di kamarB.
    await adminRoutes.request(`/users/${waliA.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [kamarA] })
    }, testEnv())

    const createSantri = await santriRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ nama_lengkap: 'Santri Lain Kamar', jenis_kelamin: 'L', kamar_id: kamarB })
    }, testEnv())
    const santri = await createSantri.json() as { data: { id: string } }

    const res = await personelRoutes.request(`/${waliA.id}/santri-riwayat`, {
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    const body = await res.json() as { data: Array<{ santri_id: string }> }
    expect(body.data.find((d) => d.santri_id === santri.data.id)).toBeUndefined()
  })
})
