import type { Env, UserPayload } from '../../types'
import { canAccessKamar } from '../scope'
import type { ScopeRule } from './types'

/**
 * Cek apakah user boleh baca/tulis baris `row` menurut ScopeRule. Generalisasi
 * dari checkSantriScopeAccess/checkCatatanScopeAccess (sync.ts lama) — 'via-santri'
 * melakukan join ke santri dulu lalu delegasi ke logika 'direct-kamar-kelas' yang
 * sama persis (kelas_ids OR kamar_ids milik user, kepala_asrama lewat canAccessKamar).
 */
export async function checkScopeRule(
  env: Env,
  user: UserPayload,
  rule: ScopeRule,
  row: Record<string, unknown>
): Promise<boolean> {
  switch (rule.kind) {
    case 'global':
      return true
    case 'role-only':
      return rule.roles.includes(user.role)
    case 'direct-kamar-kelas': {
      if (user.role === 'admin' || user.role === 'kyai') return true
      const kamarCol = rule.kamarColumn ?? 'kamar_id'
      const kelasCol = rule.kelasColumn ?? 'kelas_id'
      const kamarId = row[kamarCol] as string | null | undefined
      const kelasId = row[kelasCol] as string | null | undefined
      if (user.role === 'kepala_asrama') {
        return await canAccessKamar(env, user, kamarId)
      }
      const viaKelas = !!kelasId && user.kelas_ids.includes(kelasId)
      const viaKamar = !!kamarId && user.kamar_ids.includes(kamarId)
      return viaKelas || viaKamar
    }
    case 'via-santri': {
      const santriId = row[rule.santriIdColumn] as string | undefined
      if (!santriId) return false
      const santri = await env.DB.prepare(
        'SELECT kelas_id, kamar_id FROM santri WHERE id = ?'
      ).bind(santriId).first<{ kelas_id: string | null; kamar_id: string | null }>()
      if (!santri) return false
      return checkScopeRule(env, user, { kind: 'direct-kamar-kelas' }, santri)
    }
    case 'custom':
      return rule.check(env, user, row)
  }
}

/**
 * Cek apakah user boleh menulis ENTITY BARU ke target kelas/kamar tertentu.
 * Generalisasi dari checkSantriTargetScope. Mengembalikan error code atau null.
 * Untuk 'via-santri', target scope-nya sama dengan scope santri tujuan
 * (dipakai catatan_disiplin: target = santri_id di payload, bukan santri_id
 * milik row yang sudah ada).
 */
export async function checkTargetScopeRule(
  env: Env,
  user: UserPayload,
  rule: ScopeRule,
  target: Record<string, unknown>
): Promise<string | null> {
  switch (rule.kind) {
    case 'global':
      return null
    case 'role-only':
      return rule.roles.includes(user.role) ? null : 'INSUFFICIENT_PERMISSIONS'
    case 'direct-kamar-kelas': {
      const kamarCol = rule.kamarColumn ?? 'kamar_id'
      const kelasCol = rule.kelasColumn ?? 'kelas_id'
      const kelasId = target[kelasCol] as string | null | undefined
      const kamarId = target[kamarCol] as string | null | undefined
      if (user.role === 'ustadz') {
        if (kelasId && !user.kelas_ids.includes(kelasId)) return 'KELAS_NOT_ASSIGNED'
        if (kamarId && !user.kamar_ids.includes(kamarId)) return 'KAMAR_NOT_ASSIGNED'
      }
      if (user.role === 'kepala_asrama' && kamarId && !(await canAccessKamar(env, user, kamarId))) return 'KAMAR_NOT_IN_ASRAMA'
      return null
    }
    case 'via-santri':
      return checkTargetScopeRule(env, user, { kind: 'direct-kamar-kelas' }, target)
    case 'custom': {
      const ok = await rule.check(env, user, target)
      return ok ? null : 'FORBIDDEN'
    }
  }
}
