import { describe, expect, it } from 'vitest'
import { dashboardRoutes, defaultDateRange } from '../dashboard'
import { authHeaders, seedKamar, seedSantri, seedUser, testEnv, uuid } from '../../../test/helpers'

// Fase 4 offline-first (§A.8): kebijakan lama (audit MEDIUM #1 — kyai dapat
// catatan_haid_tercatat = null) SENGAJA dibalik sebagian atas keputusan
// produk eksplisit — kyai & admin sekarang SAMA-SAMA boleh lihat JUMLAH/
// agregat santri yang lagi haid (query murni COUNT(*), tidak pernah
// mengembalikan nama/identitas). Detail per-santri (siapa saja) TETAP
// terbatas ke ustadzah/kepala asrama putri/admin lewat assertHaidAccess di
// catatanHaid.ts, yang tidak berubah sama sekali.
describe('dashboard.ts — GET /per-wali-kamar: kyai & admin sama-sama dapat jumlah agregat data haid', () => {
  it('kyai dan admin dua-duanya dapat catatan_haid_tercatat = angka yang benar', async () => {
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    const santriId = await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })
    const wali = await seedUser({ role: 'ustadz', kamar_ids: [kamarPutri] })

    await testEnv().DB.prepare(
      `INSERT INTO catatan_haid (id, santri_id, tanggal, status, dicatat_oleh)
       VALUES (?, ?, date('now'), 'haid', ?)`
    ).bind(uuid(), santriId, wali.id).run()

    const kyai = await seedUser({ role: 'kyai' })
    const kyaiRes = await dashboardRoutes.request('/per-wali-kamar', { headers: authHeaders(kyai.accessToken) }, testEnv())
    expect(kyaiRes.status).toBe(200)
    const kyaiBody = await kyaiRes.json() as { data: Array<{ id: string; catatan_haid_tercatat: number | null }> }
    const kyaiEntry = kyaiBody.data.find((d) => d.id === wali.id)
    expect(kyaiEntry?.catatan_haid_tercatat).toBe(1)

    const admin = await seedUser({ role: 'admin' })
    const adminRes = await dashboardRoutes.request('/per-wali-kamar', { headers: authHeaders(admin.accessToken) }, testEnv())
    expect(adminRes.status).toBe(200)
    const adminBody = await adminRes.json() as { data: Array<{ id: string; catatan_haid_tercatat: number | null }> }
    const adminEntry = adminBody.data.find((d) => d.id === wali.id)
    expect(adminEntry?.catatan_haid_tercatat).toBe(1)
  })
})

// REGRESI PRODUKSI: GET /summary 500 buat kepala_asrama — `kamarFilter` di
// dashboard.ts dulu dirakit tanpa prefix tabel (`AND jenis_kelamin = ...`)
// padahal ikut ditempel ke dua query yang JOIN `kamar km` + `santri s`, dan
// KEDUA tabel punya kolom `jenis_kelamin` → SQLite nolak "ambiguous column
// name". Lolos sampai produksi karena cuma kena SATU peran: buat admin/kyai
// `aj` bernilai null sehingga filter itu jadi string kosong, jadi seluruh tes
// dashboard yang ada (semuanya admin/kyai) tetap hijau. Efeknya di lapangan:
// kepala asrama gagal total di halaman PERTAMA yang dia buka.
describe('dashboard.ts — GET /summary jalan buat kepala_asrama (regresi ambiguous column)', () => {
  it('kepala_asrama dapat 200, bukan 500, dan datanya cuma asramanya', async () => {
        const kamarPutra = await seedKamar({ jenis_kelamin: 'L' })
    const kamarPutri = await seedKamar({ jenis_kelamin: 'P' })
    await seedSantri({ jenis_kelamin: 'L', kamar_id: kamarPutra })
    await seedSantri({ jenis_kelamin: 'P', kamar_id: kamarPutri })

    const kepala = await seedUser({ role: 'kepala_asrama', asrama_jenis: 'L' })
    const res = await dashboardRoutes.request('/summary', { headers: authHeaders(kepala.accessToken) }, testEnv())

    expect(res.status).toBe(200)

    const body = await res.json() as {
      data: {
        totals: { santri: number; kamar: number }
        per_asrama: Array<{ jenis_kelamin: string }>
      }
    }
    // Cuma asrama putra yang kebawa — sekaligus bukti filternya masih jalan,
    // bukan cuma "gak error tapi bocor semua".
    expect(body.data.per_asrama.every((a) => a.jenis_kelamin === 'L')).toBe(true)
    expect(body.data.totals.santri).toBe(1)
    expect(body.data.totals.kamar).toBe(1)
  })
})

// Audit MEDIUM #5: default date range dashboard pakai UTC, bukan WIB (UTC+7).
// Antara jam 00:00-07:00 WIB, versi UTC masih nunjuk ke tanggal kemarin.
// `nowMs` di sini cuma untuk testability (lihat komentar di dashboard.ts) —
// menghindar dari perlu mock waktu lintas-realm ke Workers runtime.
describe('dashboard.ts — defaultDateRange pakai WIB, bukan UTC (audit MEDIUM #5)', () => {
  it('jam 01:00 WIB (18:00 UTC hari sebelumnya) tetap dianggap "hari ini" WIB', () => {
    // 2026-01-31T18:00:00Z = 2026-02-01T01:00:00 WIB — beda tanggal kalender
    // antara UTC dan WIB, persis kasus yang dulu salah.
    const nowMs = new Date('2026-01-31T18:00:00.000Z').getTime()
    const fakeReq = { req: { query: () => undefined } }

    const { dari, sampai } = defaultDateRange(fakeReq, nowMs)

    expect(sampai).toBe('2026-02-01')
    expect(dari).toBe('2026-01-03')
  })

  it('query param dari/sampai eksplisit tetap menang, gak ketimpa default WIB', () => {
    const nowMs = new Date('2026-01-31T18:00:00.000Z').getTime()
    const fakeReq = { req: { query: (k: string) => (k === 'dari' ? '2025-06-01' : k === 'sampai' ? '2025-06-30' : undefined) } }

    const { dari, sampai } = defaultDateRange(fakeReq, nowMs)

    expect(dari).toBe('2025-06-01')
    expect(sampai).toBe('2025-06-30')
  })
})
