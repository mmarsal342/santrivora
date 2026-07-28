import { z } from 'zod'
import { canAccessKamar } from '../../scope'
import type { Env, UserPayload } from '../../../types'
import type { EntitySyncConfig } from '../types'

const kegiatanCreateSchema = z.object({
  id: z.string().optional(),
  nama: z.string().min(1).max(200),
  jenis: z.string().max(50).nullable().optional(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kelas_id: z.string().uuid().nullable().optional(),
  kamar_id: z.string().uuid().nullable().optional()
})

const kegiatanUpdateSchema = z.object({
  id: z.string().optional(),
  nama: z.string().min(1).max(200).optional(),
  jenis: z.string().max(50).nullable().optional(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kelas_id: z.string().uuid().nullable().optional(),
  kamar_id: z.string().uuid().nullable().optional(),
  is_active: z.number().int().optional()
})

// Mirror canManage(user, kegiatanRow) di kegiatan.ts: admin/kyai selalu bisa;
// pembuat bisa kelola KECUALI kelas/kamar kegiatan-nya sudah di luar scope
// dia SEKARANG (kalau kegiatan itu kelas/kamar-spesifik); tanpa kelas/kamar
// (kegiatan umum) pembuat selalu bisa kelola.
function canManage(user: UserPayload, row: { created_by: string; kelas_id: string | null; kamar_id: string | null }): boolean {
  if (user.role === 'admin' || user.role === 'kyai') return true
  if (user.sub === row.created_by) {
    if (row.kamar_id && user.role === 'ustadz') return user.kamar_ids.includes(row.kamar_id)
    if (row.kelas_id && user.role === 'ustadz') return user.kelas_ids.includes(row.kelas_id)
    return true
  }
  return false
}

async function kegiatanReadCheck(env: Env, user: UserPayload, row: Record<string, unknown>): Promise<boolean> {
  const kelasId = row.kelas_id as string | null
  const kamarId = row.kamar_id as string | null
  if (user.role === 'admin' || user.role === 'kyai') return true
  const isGeneral = !kelasId && !kamarId
  if (user.role === 'kepala_asrama') {
    return isGeneral || (await canAccessKamar(env, user, kamarId))
  }
  const inKelas = !!kelasId && user.kelas_ids.includes(kelasId)
  const inKamar = !!kamarId && user.kamar_ids.includes(kamarId)
  return isGeneral || inKelas || inKamar
}

async function kegiatanCreateCheck(env: Env, user: UserPayload, data: Record<string, unknown>): Promise<string | null> {
  const kelasId = data.kelas_id as string | null | undefined
  const kamarId = data.kamar_id as string | null | undefined
  if (user.role !== 'admin' && !kelasId && !kamarId) return 'SCOPE_REQUIRED'
  if (user.role === 'ustadz') {
    if (kelasId && !user.kelas_ids.includes(kelasId)) return 'KELAS_NOT_ASSIGNED'
    if (kamarId && !user.kamar_ids.includes(kamarId)) return 'KAMAR_NOT_ASSIGNED'
  } else if (user.role === 'kepala_asrama') {
    if (kamarId && !(await canAccessKamar(env, user, kamarId))) return 'KAMAR_NOT_IN_ASRAMA'
  }
  return null
}

async function kegiatanWriteCheck(env: Env, user: UserPayload, current: Record<string, unknown>): Promise<string | null> {
  const row = {
    created_by: current.created_by as string,
    kelas_id: current.kelas_id as string | null,
    kamar_id: current.kamar_id as string | null
  }
  const mayManage = canManage(user, row) || (user.role === 'kepala_asrama' && (await canAccessKamar(env, user, row.kamar_id)))
  return mayManage ? null : 'INSUFFICIENT_PERMISSIONS'
}

export const kegiatanSyncConfig: EntitySyncConfig = {
  entityType: 'kegiatan',
  table: 'kegiatan',
  capability: 'full',
  idempotentCreate: true,
  createColumns: ['nama', 'jenis', 'tanggal', 'kelas_id', 'kamar_id'],
  createExtra: (_data, user) => ({ created_by: user.sub }),
  createSchema: kegiatanCreateSchema,
  updateSchema: kegiatanUpdateSchema,
  writableColumns: ['nama', 'jenis', 'tanggal', 'kelas_id', 'kamar_id', 'is_active'],
  softDelete: { column: 'is_active', setValue: 0 },
  // Baca: siapa saja yang punya akses ke kelas/kamar kegiatan ini (atau kegiatan
  // umum) boleh lihat — LEBIH LONGGAR dari izin ubah/hapus, makanya writeScope
  // dipisah (lihat kegiatanWriteCheck: cuma admin/kyai/pembuat/kepala_asrama).
  scope: { kind: 'custom', check: kegiatanReadCheck },
  scopeDeniedCode: 'KEGIATAN_NOT_ACCESSIBLE',
  notFoundCode: 'KEGIATAN_NOT_FOUND',
  customCreateCheck: kegiatanCreateCheck,
  customWriteCheck: kegiatanWriteCheck,
  pull: { timestampColumn: 'updated_at' }
}
