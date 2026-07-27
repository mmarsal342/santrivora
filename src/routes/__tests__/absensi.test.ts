import { describe, expect, it } from 'vitest'
import { absensiRoutes } from '../absensi'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv, uuid } from '../../../test/helpers'

// Audit MEDIUM #4b: POST /bulk dulu 1 query santri + 1 query verifikasi
// created/updated PER ITEM (sampai ~4 round-trip/item untuk batch 200 item).
// Sekarang dibatch jadi 2 query total buat seluruh batch. Test ini pastikan
// hasil per-item (status/id) tetap identik dengan behavior sebelumnya.
describe('absensi.ts — POST /bulk tetap benar setelah query-nya dibatch (audit MEDIUM #4b)', () => {
  it('campuran item valid & invalid di batch yang sama masing-masing hasilnya benar', async () => {
    const kamarMine = await seedKamar()
    const kamarOther = await seedKamar()
    const santriMine = await seedSantri({ kamar_id: kamarMine })
    const santriOther = await seedSantri({ kamar_id: kamarOther })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamarMine] })

    const res = await absensiRoutes.request('/bulk', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        tanggal: '2026-01-15',
        items: [
          { santri_id: santriMine, status: 'hadir' },
          { santri_id: santriOther, status: 'hadir' }, // di luar scope
          { santri_id: uuid(), status: 'hadir' } // gak ada
        ]
      })
    }, testEnv())

    expect(res.status).toBe(200)
    const body = await res.json() as { data: { results: Array<{ santri_id: string; status: string; error?: string; id?: string }> } }
    const results = body.data.results
    expect(results[0]).toMatchObject({ santri_id: santriMine, status: 'created' })
    expect(results[0].id).toBeTruthy()
    expect(results[1]).toMatchObject({ santri_id: santriOther, status: 'error', error: 'KAMAR_NOT_ASSIGNED' })
    expect(results[2]).toMatchObject({ status: 'error', error: 'SANTRI_NOT_FOUND' })
  })

  it('menandai ulang santri yang sudah punya absensi di tanggal itu hasilnya "updated" dengan id row yang sama (bukan id baru)', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const first = await absensiRoutes.request('/bulk', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({ tanggal: '2026-01-15', items: [{ santri_id: santriId, status: 'hadir' }] })
    }, testEnv())
    const firstBody = await first.json() as { data: { results: Array<{ status: string; id?: string }> } }
    expect(firstBody.data.results[0].status).toBe('created')
    const originalId = firstBody.data.results[0].id

    const second = await absensiRoutes.request('/bulk', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({ tanggal: '2026-01-15', items: [{ santri_id: santriId, status: 'sakit' }] })
    }, testEnv())
    const secondBody = await second.json() as { data: { results: Array<{ status: string; id?: string }> } }
    expect(secondBody.data.results[0].status).toBe('updated')
    expect(secondBody.data.results[0].id).toBe(originalId)

    const row = await testEnv().DB.prepare('SELECT status FROM absensi WHERE id = ?').bind(originalId).first<{ status: string }>()
    expect(row?.status).toBe('sakit')
  })

  it('santri_id dobel di batch yang SAMA tetap benar: entri pertama "created", entri kedua "updated" dengan id yang sama', async () => {
    const kamar = await seedKamar()
    const santriId = await seedSantri({ kamar_id: kamar })
    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    const res = await absensiRoutes.request('/bulk', {
      method: 'POST',
      headers: authHeaders(ustadz.accessToken),
      body: JSON.stringify({
        tanggal: '2026-01-15',
        items: [
          { santri_id: santriId, status: 'hadir' },
          { santri_id: santriId, status: 'sakit' }
        ]
      })
    }, testEnv())

    const body = await res.json() as { data: { results: Array<{ status: string; id?: string }> } }
    expect(body.data.results[0].status).toBe('created')
    expect(body.data.results[1].status).toBe('updated')
    expect(body.data.results[1].id).toBe(body.data.results[0].id)

    const countRow = await testEnv().DB.prepare('SELECT COUNT(*) as n FROM absensi WHERE santri_id = ?').bind(santriId).first<{ n: number }>()
    expect(countRow?.n).toBe(1)

    const finalRow = await testEnv().DB.prepare('SELECT status FROM absensi WHERE santri_id = ?').bind(santriId).first<{ status: string }>()
    expect(finalRow?.status).toBe('sakit')
  })
})
