import { describe, expect, it } from 'vitest'
import { santriRoutes } from '../santri'
import { authHeaders, seedKamar, seedKelas, seedSantri, seedUser, testEnv } from '../../../test/helpers'

async function namesInOrder(token: string, query: string): Promise<string[]> {
  const res = await santriRoutes.request(`/?${query}`, { headers: authHeaders(token) }, testEnv())
  const body = await res.json() as { data: Array<{ nama_lengkap: string }> }
  return body.data.map((s) => s.nama_lengkap)
}

describe('santri.ts — GET / sort (default nama, dukung kelas/kamar)', () => {
  it('default (tanpa sort param) tetap abjad per nama, bukan lagi urutan id acak', async () => {
    const admin = await seedUser({ role: 'admin' })
    await seedSantri({ nama_lengkap: 'Zaid' })
    await seedSantri({ nama_lengkap: 'ahmad' })
    await seedSantri({ nama_lengkap: 'Budi' })

    const names = await namesInOrder(admin.accessToken, 'limit=100')
    const filtered = names.filter((n) => ['Zaid', 'ahmad', 'Budi'].includes(n))
    expect(filtered).toEqual(['ahmad', 'Budi', 'Zaid'])
  })

  it('sort=kelas mengelompokkan per nama kelas (abjad), lalu abjad nama di dalam grup', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kelasB = await seedKelas({ nama: 'Kelas B' })
    const kelasA = await seedKelas({ nama: 'Kelas A' })
    await seedSantri({ nama_lengkap: 'Zainab', kelas_id: kelasB })
    await seedSantri({ nama_lengkap: 'Umar', kelas_id: kelasA })
    await seedSantri({ nama_lengkap: 'Aisyah', kelas_id: kelasA })

    const names = await namesInOrder(admin.accessToken, 'limit=100&sort=kelas')
    const filtered = names.filter((n) => ['Zainab', 'Umar', 'Aisyah'].includes(n))
    // Kelas A duluan (Aisyah, Umar abjad), baru Kelas B (Zainab)
    expect(filtered).toEqual(['Aisyah', 'Umar', 'Zainab'])
  })

  it('sort=kamar mengelompokkan per nama kamar (abjad), lalu abjad nama di dalam grup', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kamarPutra = await seedKamar({ nama: 'Kamar Al-Fath', jenis_kelamin: 'L' })
    const kamarPutri = await seedKamar({ nama: 'Kamar Az-Zahra', jenis_kelamin: 'P' })
    await seedSantri({ nama_lengkap: 'Yusuf', jenis_kelamin: 'L', kamar_id: kamarPutra })
    await seedSantri({ nama_lengkap: 'Fatimah', jenis_kelamin: 'P', kamar_id: kamarPutri })
    await seedSantri({ nama_lengkap: 'Ali', jenis_kelamin: 'L', kamar_id: kamarPutra })

    const names = await namesInOrder(admin.accessToken, 'limit=100&sort=kamar')
    const filtered = names.filter((n) => ['Yusuf', 'Fatimah', 'Ali'].includes(n))
    expect(filtered).toEqual(['Ali', 'Yusuf', 'Fatimah'])
  })

  it('santri tanpa kelas muncul di grup awal (kosong) saat sort=kelas', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kelas = await seedKelas({ nama: 'Kelas Z' })
    await seedSantri({ nama_lengkap: 'Punya Kelas', kelas_id: kelas })
    await seedSantri({ nama_lengkap: 'Tanpa Kelas', kelas_id: null })

    const names = await namesInOrder(admin.accessToken, 'limit=100&sort=kelas')
    const filtered = names.filter((n) => ['Punya Kelas', 'Tanpa Kelas'].includes(n))
    expect(filtered).toEqual(['Tanpa Kelas', 'Punya Kelas'])
  })

  it('sort tidak valid jatuh ke default nama, bukan error', async () => {
    const admin = await seedUser({ role: 'admin' })
    await seedSantri({ nama_lengkap: 'Zaid2' })
    await seedSantri({ nama_lengkap: 'Ahmad2' })

    const res = await santriRoutes.request('/?limit=100&sort=tidak_valid', { headers: authHeaders(admin.accessToken) }, testEnv())
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ nama_lengkap: string }> }
    const filtered = body.data.map((s) => s.nama_lengkap).filter((n) => ['Zaid2', 'Ahmad2'].includes(n))
    expect(filtered).toEqual(['Ahmad2', 'Zaid2'])
  })

  it('pagination (cursor) tetap konsisten mengikuti sort=kelas lintas halaman', async () => {
    const admin = await seedUser({ role: 'admin' })
    const kelas = await seedKelas({ nama: 'Kelas Sama' })
    const names = ['Charlie', 'Alpha', 'Bravo', 'Delta', 'Echo']
    for (const n of names) {
      await seedSantri({ nama_lengkap: n, kelas_id: kelas })
    }

    const page1 = await santriRoutes.request(`/?limit=2&sort=kelas&kelas_id=${kelas}`, { headers: authHeaders(admin.accessToken) }, testEnv())
    const body1 = await page1.json() as { data: Array<{ nama_lengkap: string }>; pagination: { cursor: string | null; hasMore: boolean } }
    expect(body1.data.map((s) => s.nama_lengkap)).toEqual(['Alpha', 'Bravo'])
    expect(body1.pagination.hasMore).toBe(true)

    const page2 = await santriRoutes.request(
      `/?limit=2&sort=kelas&kelas_id=${kelas}&cursor=${encodeURIComponent(body1.pagination.cursor!)}`,
      { headers: authHeaders(admin.accessToken) }, testEnv()
    )
    const body2 = await page2.json() as { data: Array<{ nama_lengkap: string }>; pagination: { cursor: string | null; hasMore: boolean } }
    expect(body2.data.map((s) => s.nama_lengkap)).toEqual(['Charlie', 'Delta'])

    const page3 = await santriRoutes.request(
      `/?limit=2&sort=kelas&kelas_id=${kelas}&cursor=${encodeURIComponent(body2.pagination.cursor!)}`,
      { headers: authHeaders(admin.accessToken) }, testEnv()
    )
    const body3 = await page3.json() as { data: Array<{ nama_lengkap: string }>; pagination: { cursor: string | null; hasMore: boolean } }
    expect(body3.data.map((s) => s.nama_lengkap)).toEqual(['Echo'])
    expect(body3.pagination.hasMore).toBe(false)
  })

  it('cursor yang rusak/tidak valid diabaikan (mulai dari awal), bukan error 500', async () => {
    const admin = await seedUser({ role: 'admin' })
    await seedSantri({ nama_lengkap: 'Test Cursor Rusak' })

    const res = await santriRoutes.request('/?limit=10&cursor=bukan-json-valid', { headers: authHeaders(admin.accessToken) }, testEnv())
    expect(res.status).toBe(200)
  })

  it('cursor JSON valid tapi bentuknya salah (field hilang/tipe salah) diabaikan, bukan 500', async () => {
    const admin = await seedUser({ role: 'admin' })
    await seedSantri({ nama_lengkap: 'Test Cursor Shape' })

    const malformedCursors = ['{}', '{"id":"x"}', '{"n":123,"id":"x"}', '{"n":"x","id":456}', '{"g":123,"n":"x","id":"y"}']
    for (const cursor of malformedCursors) {
      const res = await santriRoutes.request(
        `/?limit=10&sort=kelas&cursor=${encodeURIComponent(cursor)}`,
        { headers: authHeaders(admin.accessToken) }, testEnv()
      )
      expect(res.status).toBe(200)
    }
  })
})
