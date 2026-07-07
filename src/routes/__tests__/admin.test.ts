import { describe, expect, it } from 'vitest'
import { adminRoutes } from '../admin'
import { authHeaders, seedKamar, seedUser, testEnv } from '../../../test/helpers'

describe('admin.ts — POST /users/:id/approve (kelas -> kamar consolidation)', () => {
  it('approval pertama kali WAJIB minimal 1 kamar (400 kalau kosong)', async () => {
    const admin = await seedUser({ role: 'admin' })
    const pending = await seedUser({ role: 'ustadz', status: 'pending', kamar_ids: [] })

    const res = await adminRoutes.request(`/users/${pending.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [] })
    }, testEnv())

    expect(res.status).toBe(400)
  })

  it('approval pertama kali sukses dengan >=1 kamar, status jadi approved', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamar = await seedKamar()
    const pending = await seedUser({ role: 'ustadz', status: 'pending', kamar_ids: [] })

    const res = await adminRoutes.request(`/users/${pending.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [kamar] })
    }, testEnv())

    expect(res.status).toBe(200)
    const row = await testEnv().DB.prepare('SELECT status FROM users WHERE id = ?').bind(pending.id).first<{ status: string }>()
    expect(row?.status).toBe('approved')

    const audit = await testEnv().DB.prepare(
      "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(pending.id).first<{ action: string }>()
    expect(audit?.action).toBe('user.approve')
  })

  it('user yang UDAH approved boleh dikosongkan semua kamarnya (bukan lagi wajib min 1)', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamar = await seedKamar()
    const approved = await seedUser({ role: 'ustadz', status: 'approved', kamar_ids: [kamar] })

    const res = await adminRoutes.request(`/users/${approved.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [] })
    }, testEnv())

    expect(res.status).toBe(200)
    const rows = await testEnv().DB.prepare('SELECT kamar_id FROM ustadz_kamar WHERE user_id = ?').bind(approved.id).all()
    expect(rows.results.length).toBe(0)
  })

  it('edit kamar buat user yang udah approved di-log sebagai user.update_kamar, bukan user.approve', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamarLama = await seedKamar()
    const kamarBaru = await seedKamar()
    const approved = await seedUser({ role: 'ustadz', status: 'approved', kamar_ids: [kamarLama] })

    await adminRoutes.request(`/users/${approved.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [kamarBaru] })
    }, testEnv())

    const audit = await testEnv().DB.prepare(
      "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(approved.id).first<{ action: string }>()
    expect(audit?.action).toBe('user.update_kamar')
  })

  it('nolak kamar_id yang gak ada / gak aktif dengan 400', async () => {
    const admin = await seedUser({ role: 'admin' })
    const pending = await seedUser({ role: 'ustadz', status: 'pending' })

    const res = await adminRoutes.request(`/users/${pending.id}/approve`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ kamar_ids: [crypto.randomUUID()] })
    }, testEnv())

    expect(res.status).toBe(400)
  })

  it('bukan admin ditolak 403', async () => {
    const ustadz = await seedUser({ role: 'ustadz' })
    const pending = await seedUser({ role: 'ustadz', status: 'pending' })

    const res = await adminRoutes.request(`/users/${pending.id}/approve`, {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({ kamar_ids: [] })
    }, testEnv())

    expect(res.status).toBe(403)
  })
})
