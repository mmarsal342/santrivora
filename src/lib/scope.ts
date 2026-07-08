import type { Context, Next } from 'hono'
import type { ApiError, Env, Role, UserPayload } from '../types'

/** Akses baca global (admin, kyai). Kepala asrama terbatas asramanya. */
export function isGlobalRead(user: UserPayload): boolean {
  return user.role === 'admin' || user.role === 'kyai'
}

/** Bisa melihat semua data lintas asrama (admin, kyai, kepala_asrama — tapi kepala asrama difilter per-query). */
export function isPrivileged(user: UserPayload): boolean {
  return user.role === 'admin' || user.role === 'kyai' || user.role === 'kepala_asrama'
}

/** Kyai read-only di mana-mana (kecuali pesan). */
export function isReadOnly(user: UserPayload): boolean {
  return user.role === 'kyai'
}

/** Boleh mutasi data: admin, ustadz, kepala_asrama. Kyai tidak. */
export function canMutate(user: UserPayload): boolean {
  return user.role !== 'kyai'
}

/**
 * Resolve himpunan kamar_id yang boleh dilihat user.
 * - null  = tanpa batas (admin, kyai — global)
 * - []    = tidak punya akses kamar sama sekali
 * - [...] = daftar kamar (kepala_asrama: semua kamar asramanya; ustadz: kamar yg dipegang)
 *
 * Kepala asrama di-query saat runtime supaya selalu segar (kamar bisa ditambah/dinonaktifkan).
 */
export async function resolveKamarScope(env: Env, user: UserPayload): Promise<string[] | null> {
  if (user.role === 'admin' || user.role === 'kyai') return null
  if (user.role === 'kepala_asrama') {
    const asrama = user.asrama_jenis
    if (!asrama) return []
    const rows = await env.DB.prepare(
      'SELECT id FROM kamar WHERE jenis_kelamin = ? AND is_active = 1'
    ).bind(asrama).all<{ id: string }>()
    return (rows.results || []).map((r) => r.id)
  }
  // ustadz
  return user.kamar_ids
}

/** Cek apakah sebuah kamar berada dalam lingkup asrama user (untuk kepala_asrama). */
export function asramaMatches(user: UserPayload, kamarJenisKelamin: 'L' | 'P'): boolean {
  if (user.role !== 'kepala_asrama') return true
  return user.asrama_jenis === kamarJenisKelamin
}

/** Cek apakah user boleh akses kamar tertentu (berdasarkan role + asrama/assignment). */
export async function canAccessKamar(env: Env, user: UserPayload, kamarId: string | null | undefined): Promise<boolean> {
  if (user.role === 'admin' || user.role === 'kyai') return true
  if (!kamarId) return false
  if (user.role === 'kepala_asrama') {
    if (!user.asrama_jenis) return false
    const row = await env.DB.prepare('SELECT jenis_kelamin FROM kamar WHERE id = ? AND is_active = 1').bind(kamarId).first<{ jenis_kelamin: string }>()
    return !!row && row.jenis_kelamin === user.asrama_jenis
  }
  // ustadz
  return user.kamar_ids.includes(kamarId)
}

/** Middleware: izinkan salah satu dari daftar role. */
export function requireAnyRole(...roles: Role[]) {
  return async (c: Context<{ Bindings: Env; Variables: { user: UserPayload } }>, next: Next) => {
    const user = c.get('user')
    if (!roles.includes(user.role)) {
      return c.json({
        error: 'Forbidden',
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'Anda tidak memiliki akses ke resource ini.'
      } as ApiError, 403)
    }
    await next()
  }
}

/** Middleware: khusus admin. */
export const requireAdmin = requireAnyRole('admin')

/** Middleware: tolak kyai (read-only). Dipakai di endpoint mutasi data. */
export function requireCanMutate() {
  return async (c: Context<{ Bindings: Env; Variables: { user: UserPayload } }>, next: Next) => {
    const user = c.get('user')
    if (isReadOnly(user)) {
      return c.json({
        error: 'Forbidden',
        code: 'READ_ONLY_ROLE',
        message: 'Peran Anda bersifat read-only.'
      } as ApiError, 403)
    }
    await next()
  }
}
