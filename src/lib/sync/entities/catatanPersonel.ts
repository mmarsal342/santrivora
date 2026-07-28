import { z } from 'zod'
import type { Env, UserPayload } from '../../../types'
import type { EntitySyncConfig } from '../types'

const KATEGORI_OPTIONS = ['Kinerja', 'Kehadiran', 'Pelanggaran', 'Prestasi', 'Keputusan Kyai', 'Lainnya'] as const

const catatanPersonelCreateSchema = z.object({
  id: z.string().optional(),
  personel_id: z.string().uuid(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kategori: z.enum(KATEGORI_OPTIONS),
  judul: z.string().min(1).max(300),
  catatan: z.string().max(2000).nullable().optional()
})

const catatanPersonelUpdateSchema = z.object({
  id: z.string().optional(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kategori: z.enum(KATEGORI_OPTIONS).optional(),
  judul: z.string().min(1).max(300).optional(),
  catatan: z.string().max(2000).nullable().optional()
})

async function catatanPersonelCreateCheck(env: Env, user: UserPayload, data: Record<string, unknown>): Promise<string | null> {
  if (user.role !== 'admin' && user.role !== 'kyai') return 'INSUFFICIENT_PERMISSIONS'
  const personelId = data.personel_id as string | undefined
  if (!personelId) return 'PERSONEL_ID_REQUIRED'
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(personelId).first()
  if (!exists) return 'PERSONEL_NOT_FOUND'
  return null
}

export const catatanPersonelSyncConfig: EntitySyncConfig = {
  entityType: 'catatan_personel',
  table: 'catatan_personel',
  capability: 'full',
  idempotentCreate: false,
  createColumns: ['personel_id', 'tanggal', 'kategori', 'judul', 'catatan'],
  createExtra: (_data, user) => ({ dicatat_oleh: user.sub }),
  createSchema: catatanPersonelCreateSchema,
  updateSchema: catatanPersonelUpdateSchema,
  writableColumns: ['tanggal', 'kategori', 'judul', 'catatan'],
  softDelete: { column: 'is_deleted', setValue: 1, excludeFromFetch: true },
  // Khusus admin & kyai — tidak ada dimensi kelas/kamar sama sekali (beda
  // dari catatan_disiplin/catatan_perkembangan yang lewat santri). Kyai di
  // sini SENGAJA salah satu penulis utama (readOnlyRoles:[] override default).
  scope: { kind: 'role-only', roles: ['admin', 'kyai'] },
  scopeDeniedCode: 'INSUFFICIENT_PERMISSIONS',
  notFoundCode: 'CATATAN_NOT_FOUND',
  customCreateCheck: catatanPersonelCreateCheck,
  readOnlyRoles: [],
  pull: { timestampColumn: 'updated_at' }
}
