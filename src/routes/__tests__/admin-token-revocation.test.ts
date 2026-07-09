import { describe, expect, it } from 'vitest'
import { adminRoutes } from '../admin'
import { santriRoutes } from '../santri'
import { generateTokens } from '../../services/auth'
import { authHeaders, seedUser, testEnv } from '../../../test/helpers'

// Regresi audit HIGH #3: admin suspend/assign-role dulu hanya revoke sesi refresh
// (tabel `sessions`), tapi access token yang masih hidup (s/d 15 menit) tetap jalan
// dengan role/status lama. Sekarang authMiddleware juga cek cutoff per-user di KV
// (`revoke_before:${userId}`) yang dibandingkan ke `iat` token.
describe('admin.ts — suspend/assign-role langsung mematikan access token yang masih hidup (audit HIGH #3)', () => {
  it('access token lama TIDAK bisa dipakai lagi setelah admin suspend user itu', async () => {
    const admin = await seedUser({ role: 'admin' })
    const target = await seedUser({ role: 'ustadz' })

    // Token lama masih valid sebelum di-suspend.
    const before = await santriRoutes.request('/', { headers: authHeaders(target.accessToken) }, testEnv())
    expect(before.status).toBe(200)

    const suspendRes = await adminRoutes.request(`/users/${target.id}/suspend`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    expect(suspendRes.status).toBe(200)

    const after = await santriRoutes.request('/', { headers: authHeaders(target.accessToken) }, testEnv())
    expect(after.status).toBe(401)
    const body = await after.json() as { code: string }
    expect(body.code).toBe('TOKEN_REVOKED')
  })

  it('access token lama TIDAK bisa dipakai lagi setelah admin ganti role/asrama user itu', async () => {
    const admin = await seedUser({ role: 'admin' })
    const target = await seedUser({ role: 'ustadz' })

    const assignRes = await adminRoutes.request(`/users/${target.id}/assign-role`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ role: 'kyai' })
    }, testEnv())
    expect(assignRes.status).toBe(200)

    const after = await santriRoutes.request('/', { headers: authHeaders(target.accessToken) }, testEnv())
    expect(after.status).toBe(401)
    const body = await after.json() as { code: string }
    expect(body.code).toBe('TOKEN_REVOKED')
  })

  it('token BARU hasil re-login (terbit setelah cutoff) tetap valid — tidak mengulang bug blacklist blanket', async () => {
    const admin = await seedUser({ role: 'admin' })
    const target = await seedUser({ role: 'ustadz' })

    const suspendRes = await adminRoutes.request(`/users/${target.id}/suspend`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken)
    }, testEnv())
    expect(suspendRes.status).toBe(200)

    await adminRoutes.request(`/users/${target.id}/activate`, {
      method: 'POST',
      headers: authHeaders(admin.accessToken)
    }, testEnv())

    // Cutoff granularitasnya per detik (lihat komentar di invalidateUserAccessTokens) —
    // lewati batas detik itu dulu supaya token "re-login" ini beneran di detik setelah
    // cutoff, bukan cuma kebetulan sama karena test-nya jalan cepat.
    await new Promise((resolve) => setTimeout(resolve, 1100))

    // Simulasikan re-login: token baru, iat setelah cutoff invalidasi di atas.
    const fresh = await generateTokens(
      target.id, target.email, 'ustadz', [],
      { access: testEnv().JWT_ACCESS_SECRET, refresh: testEnv().JWT_REFRESH_SECRET },
      []
    )

    const res = await santriRoutes.request('/', { headers: authHeaders(fresh.access_token) }, testEnv())
    expect(res.status).toBe(200)
  })
})
