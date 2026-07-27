import { describe, expect, it } from 'vitest'
import { authRoutes } from '../auth'
import { santriRoutes } from '../santri'
import { generateTokens } from '../../services/auth'
import { authHeaders, seedUser, testEnv } from '../../../test/helpers'

// Gap yang ditemukan saat re-check audit round 6: change-password self-service cuma
// blacklist jti dari REQUEST ITU SENDIRI (device yang lagi dipakai) — access token
// yang masih hidup di device LAIN (jti berbeda) tetap jalan normal sampai sisa TTL-nya.
// Ini persis skenario "akun kecolongan, buru-buru ganti password" yang paling butuh
// langsung diputus. Fix: pakai revoke_before cutoff yang sama seperti admin
// suspend/assign-role, dengan offset -1 detik supaya token baru yang di-mint di
// response yang sama (buat device yang lagi dipakai) tidak ikut ke-block sendiri.
describe('auth.ts — POST /change-password memutus access token di device lain (audit follow-up)', () => {
  it('token device lain (jti berbeda, belum pernah diblacklist) ditolak setelah change-password', async () => {
    const user = await seedUser({ role: 'ustadz' })

    // Simulasikan device kedua: token lain untuk user yang sama, iat sebelum change-password.
    const otherDeviceTokens = await generateTokens(
      user.id, user.email, 'ustadz', user.kelasIds,
      { access: testEnv().JWT_ACCESS_SECRET, refresh: testEnv().JWT_REFRESH_SECRET },
      user.kamarIds
    )

    const before = await santriRoutes.request('/', { headers: authHeaders(otherDeviceTokens.access_token) }, testEnv())
    expect(before.status).toBe(200)

    // Cutoff granularitasnya per detik (dengan offset -1, lihat komentar di
    // invalidateUserAccessTokens) — lewati batas detik dulu supaya token "device
    // lain" ini beneran di detik SEBELUM change-password, bukan kebetulan sama
    // karena test-nya jalan cepat (kalau sama, token itu akan dianggap "baru saja
    // di-mint" alih-alih "device lain yang lebih tua" — persis exemption yang
    // sengaja dikasih ke token baru punya device yang lagi dipakai).
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const changeRes = await authRoutes.request('/change-password', {
      method: 'POST',
      headers: authHeaders(user.accessToken),
      body: JSON.stringify({ current_password: 'Test1234!', new_password: 'NewPass1234!' })
    }, testEnv())
    expect(changeRes.status).toBe(200)

    const after = await santriRoutes.request('/', { headers: authHeaders(otherDeviceTokens.access_token) }, testEnv())
    expect(after.status).toBe(401)
    const body = await after.json() as { code: string }
    expect(body.code).toBe('TOKEN_REVOKED')
  })

  it('token baru hasil response change-password (device yang lagi dipakai) TETAP valid — tidak self-lockout', async () => {
    const user = await seedUser({ role: 'ustadz' })

    const changeRes = await authRoutes.request('/change-password', {
      method: 'POST',
      headers: authHeaders(user.accessToken),
      body: JSON.stringify({ current_password: 'Test1234!', new_password: 'NewPass1234!' })
    }, testEnv())
    expect(changeRes.status).toBe(200)
    const changeBody = await changeRes.json() as { data?: { access_token?: string }, access_token?: string }
    const newAccessToken = changeBody.data?.access_token ?? changeBody.access_token
    expect(newAccessToken).toBeTruthy()

    const res = await santriRoutes.request('/', { headers: authHeaders(newAccessToken!) }, testEnv())
    expect(res.status).toBe(200)
  })
})
