import { env } from 'cloudflare:test'
import { generateTokens, hashPassword } from '../src/services/auth'
import type { Env } from '../src/types'

export function testEnv(): Env {
  return env as unknown as Env
}

export function uuid(): string {
  return crypto.randomUUID()
}

export async function seedKelas(overrides: Partial<{ nama: string; is_active: number }> = {}) {
  const id = uuid()
  const nama = overrides.nama ?? `Kelas ${id.slice(0, 6)}`
  await testEnv().DB.prepare(
    'INSERT INTO kelas (id, nama, is_active) VALUES (?, ?, ?)'
  ).bind(id, nama, overrides.is_active ?? 1).run()
  return id
}

export async function seedKamar(overrides: Partial<{ nama: string; jenis_kelamin: 'L' | 'P'; is_active: number }> = {}) {
  const id = uuid()
  const nama = overrides.nama ?? `Kamar ${id.slice(0, 6)}`
  await testEnv().DB.prepare(
    'INSERT INTO kamar (id, nama, jenis_kelamin, is_active) VALUES (?, ?, ?, ?)'
  ).bind(id, nama, overrides.jenis_kelamin ?? 'L', overrides.is_active ?? 1).run()
  return id
}

export async function seedSantri(overrides: Partial<{
  nama_lengkap: string
  jenis_kelamin: 'L' | 'P'
  kelas_id: string | null
  kamar_id: string | null
  status: 'aktif' | 'lulus' | 'keluar'
}> = {}) {
  const id = uuid()
  await testEnv().DB.prepare(
    `INSERT INTO santri (id, nama_lengkap, jenis_kelamin, kelas_id, kamar_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    overrides.nama_lengkap ?? `Santri ${id.slice(0, 6)}`,
    overrides.jenis_kelamin ?? 'L',
    overrides.kelas_id ?? null,
    overrides.kamar_id ?? null,
    overrides.status ?? 'aktif'
  ).run()
  return id
}

interface SeedUserOptions {
  role?: 'admin' | 'ustadz'
  kelas_ids?: string[]
  kamar_ids?: string[]
  status?: 'pending' | 'approved' | 'suspended'
}

// Bikin user + (kalau ustadz) isi ustadz_kelas/ustadz_kamar, lalu mint access
// token yang persis kayak yang dipakai production (generateTokens), jadi
// authMiddleware/scoping ke-test end-to-end lewat token asli, bukan mock.
export async function seedUser(opts: SeedUserOptions = {}) {
  const id = uuid()
  const role = opts.role ?? 'ustadz'
  const status = opts.status ?? 'approved'
  const kelasIds = opts.kelas_ids ?? []
  const kamarIds = opts.kamar_ids ?? []
  const email = `${id}@test.local`

  await testEnv().DB.prepare(
    `INSERT INTO users (id, email, password_hash, nama_lengkap, role, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, email, await hashPassword('Test1234!'), `Test User ${id.slice(0, 6)}`, role, status).run()

  for (const kelasId of kelasIds) {
    await testEnv().DB.prepare(
      'INSERT INTO ustadz_kelas (user_id, kelas_id) VALUES (?, ?)'
    ).bind(id, kelasId).run()
  }
  for (const kamarId of kamarIds) {
    await testEnv().DB.prepare(
      'INSERT INTO ustadz_kamar (user_id, kamar_id) VALUES (?, ?)'
    ).bind(id, kamarId).run()
  }

  const tokens = await generateTokens(
    id,
    email,
    role,
    kelasIds,
    { access: testEnv().JWT_ACCESS_SECRET, refresh: testEnv().JWT_REFRESH_SECRET },
    kamarIds
  )

  return { id, email, role, kelasIds, kamarIds, accessToken: tokens.access_token }
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}
