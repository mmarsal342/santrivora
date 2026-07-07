import { describe, expect, it } from 'vitest'
import { kegiatanRoutes } from '../kegiatan'
import { authHeaders, seedKamar, seedUser, testEnv, uuid } from '../../../test/helpers'

async function seedJadwal(overrides: Partial<{ nama: string; kamar_id: string | null; created_by: string }> = {}) {
  const id = uuid()
  await testEnv().DB.prepare(
    `INSERT INTO jadwal_kegiatan (id, nama, urutan, kamar_id, created_by)
     VALUES (?, ?, 0, ?, ?)`
  ).bind(id, overrides.nama ?? 'Sholat Subuh Berjamaah', overrides.kamar_id ?? null, overrides.created_by ?? uuid()).run()
  return id
}

const today = () => new Date().toISOString().slice(0, 10)

describe('kegiatan.ts — materialize dari jadwal_kegiatan', () => {
  it('GET ?tanggal=today bikin instance kegiatan otomatis dari template aktif', async () => {
    const admin = await seedUser({ role: 'admin' })
    await seedJadwal({ nama: 'Sholat Subuh Berjamaah', created_by: admin.id })

    const res = await kegiatanRoutes.request(`/?tanggal=${today()}`, { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res.json() as { data: Array<{ nama: string; jadwal_kegiatan_id: string | null; created_by: string }> }

    expect(body.data.length).toBe(1)
    expect(body.data[0].nama).toBe('Sholat Subuh Berjamaah')
    // created_by harus ikut PEMILIK TEMPLATE, bukan admin yang lagi request ini
    expect(body.data[0].created_by).toBe(admin.id)
  })

  it('created_by instance ikut template meski yang men-trigger materialize adalah user lain', async () => {
    const templateOwner = await seedUser({ role: 'admin' })
    const kamar = await seedKamar()
    await seedJadwal({ nama: 'Sholat Isya Berjamaah', kamar_id: kamar, created_by: templateOwner.id })

    const walikamarA = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })
    const walikamarB = await seedUser({ role: 'ustadz', kamar_ids: [kamar] })

    // A yang pertama buka halaman & men-trigger materialize
    await kegiatanRoutes.request(`/?tanggal=${today()}&kamar_id=${kamar}`, { headers: authHeaders(walikamarA.accessToken) }, testEnv())

    const listRes = await kegiatanRoutes.request(`/?tanggal=${today()}&kamar_id=${kamar}`, { headers: authHeaders(walikamarB.accessToken) }, testEnv())
    const body = await listRes.json() as { data: Array<{ id: string; created_by: string }> }
    expect(body.data.length).toBe(1)
    expect(body.data[0].created_by).toBe(templateOwner.id)
    expect(body.data[0].created_by).not.toBe(walikamarA.id)

    // B (bukan admin, bukan created_by) coba edit instance bersama itu — harus tetap 403
    // (dia bukan admin dan bukan pemilik, jadi hasilnya sama seperti sebelum ada auto-materialize)
    const editRes = await kegiatanRoutes.request(`/${body.data[0].id}`, {
      method: 'PUT',
      headers: authHeaders(walikamarB.accessToken),
      body: JSON.stringify({ nama: 'Ganti nama' })
    }, testEnv())
    expect(editRes.status).toBe(403)
  })

  it('TIDAK materialize buat tanggal yang udah lewat (jangan fabrikasi histori)', async () => {
    const admin = await seedUser({ role: 'admin' })
    await seedJadwal({ nama: 'Kegiatan Baru Banget', created_by: admin.id })

    const res = await kegiatanRoutes.request('/?tanggal=2000-01-01', { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res.json() as { data: unknown[] }
    expect(body.data.length).toBe(0)
  })

  it('idempoten — panggil GET dua kali di tanggal yang sama gak bikin duplikat', async () => {
    const admin = await seedUser({ role: 'admin' })
    await seedJadwal({ nama: 'Ta\'lim Malam', created_by: admin.id })

    await kegiatanRoutes.request(`/?tanggal=${today()}`, { headers: authHeaders(admin.accessToken) }, testEnv())
    const res2 = await kegiatanRoutes.request(`/?tanggal=${today()}`, { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res2.json() as { data: unknown[] }
    expect(body.data.length).toBe(1)
  })

  it('template nonaktif (is_active=0) gak dimaterialize', async () => {
    const admin = await seedUser({ role: 'admin' })
    const id = uuid()
    await testEnv().DB.prepare(
      `INSERT INTO jadwal_kegiatan (id, nama, urutan, is_active, created_by) VALUES (?, ?, 0, 0, ?)`
    ).bind(id, 'Nonaktif', admin.id).run()

    const res = await kegiatanRoutes.request(`/?tanggal=${today()}`, { headers: authHeaders(admin.accessToken) }, testEnv())
    const body = await res.json() as { data: unknown[] }
    expect(body.data.length).toBe(0)
  })
})

describe('kegiatan.ts — scoping ustadz kelas/kamar/umum tetap konsisten', () => {
  it('kegiatan umum (tanpa kelas/kamar) kelihatan buat semua ustadz', async () => {
    const admin = await seedUser({ role: 'admin' })
    const createRes = await kegiatanRoutes.request('/', {
      method: 'POST',
      headers: authHeaders(admin.accessToken),
      body: JSON.stringify({ nama: 'Apel Pagi', tanggal: today() })
    }, testEnv())
    expect(createRes.status).toBe(201)

    const ustadz = await seedUser({ role: 'ustadz', kamar_ids: [await seedKamar()] })
    const res = await kegiatanRoutes.request(`/?tanggal=${today()}`, { headers: authHeaders(ustadz.accessToken) }, testEnv())
    const body = await res.json() as { data: unknown[] }
    expect(body.data.some((k: any) => k.nama === 'Apel Pagi')).toBe(true)
  })
})
