import { describe, expect, it } from 'vitest'
import { pesanRoutes } from '../pesan'
import { authHeaders, seedKamar, seedUser, testEnv } from '../../../test/helpers'

// Ditemukan dari pemakaian nyata, sekelas dengan bug rekap per-wali-kamar:
// daftar calon penerima pesan disaring `role = 'ustadz'`, sehingga kyai/admin
// tidak pernah bisa MEMILIH kepala asrama sebagai tujuan pesan langsung —
// jabatan itu praktis tidak bisa dikirimi pesan sama sekali.
//
// Perlu dicatat sisi INBOX-nya sudah lama benar: kepala asrama menerima
// broadcast lewat `asrama_jenis`-nya, dan pesan langsung ke `penerima_id`-nya
// pun akan sampai kalau ada yang mengirim. Jadi yang rusak memang cuma daftar
// pemilihnya, bukan pengirimannya.
describe('pesan.ts — GET /recipients/list mencakup kepala asrama, bukan cuma ustadz', () => {
  it('kepala_asrama muncul sebagai calon penerima', async () => {
    const kepala = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'P', status: 'approved' })
    const kyai = await seedUser({ role: 'kyai' })

    const res = await pesanRoutes.request('/recipients/list', { headers: authHeaders(kyai.accessToken) }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ id: string }> }
    expect(body.data.map((d) => d.id)).toContain(kepala.id)
  })

  it('ustadz tetap muncul (perilaku lama tidak boleh hilang)', async () => {
    const ustadz = await seedUser({ role: 'ustadz', status: 'approved', kamar_ids: [await seedKamar()] })
    const admin = await seedUser({ role: 'admin' })

    const res = await pesanRoutes.request('/recipients/list', { headers: authHeaders(admin.accessToken) }, testEnv())

    const body = await res.json() as { data: Array<{ id: string }> }
    expect(body.data.map((d) => d.id)).toContain(ustadz.id)
  })

  it('kepala asrama yang TIDAK memegang kamar tetap punya label asrama (fallback ke asrama_jenis)', async () => {
    const kepala = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'P', status: 'approved' })
    const admin = await seedUser({ role: 'admin' })

    const res = await pesanRoutes.request('/recipients/list', { headers: authHeaders(admin.accessToken) }, testEnv())

    const body = await res.json() as { data: Array<{ id: string; asrama: string | null }> }
    const entry = body.data.find((d) => d.id === kepala.id)
    expect(entry?.asrama).toBe('P')
  })

  it('kyai & admin TIDAK ikut jadi calon penerima — merekalah pengirimnya', async () => {
    const kyaiLain = await seedUser({ role: 'kyai', status: 'approved' })
    const adminLain = await seedUser({ role: 'admin', status: 'approved' })
    const admin = await seedUser({ role: 'admin' })

    const res = await pesanRoutes.request('/recipients/list', { headers: authHeaders(admin.accessToken) }, testEnv())

    const ids = (await res.json() as { data: Array<{ id: string }> }).data.map((d) => d.id)
    expect(ids).not.toContain(kyaiLain.id)
    expect(ids).not.toContain(adminLain.id)
  })

  it('akun yang belum approved tidak ikut muncul', async () => {
    const belumApprove = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'L', status: 'pending' })
    const admin = await seedUser({ role: 'admin' })

    const res = await pesanRoutes.request('/recipients/list', { headers: authHeaders(admin.accessToken) }, testEnv())

    const ids = (await res.json() as { data: Array<{ id: string }> }).data.map((d) => d.id)
    expect(ids).not.toContain(belumApprove.id)
  })
})
