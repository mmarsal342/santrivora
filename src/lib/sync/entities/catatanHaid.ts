import { z } from 'zod'
import type { Env, UserPayload } from '../../../types'
import type { EntitySyncConfig } from '../types'

const catatanHaidCreateSchema = z.object({
  id: z.string().optional(),
  santri_id: z.string().uuid(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['suci', 'haid']),
  catatan: z.string().max(500).nullable().optional()
})

const catatanHaidUpdateSchema = z.object({
  id: z.string().optional(),
  status: z.enum(['suci', 'haid']).optional(),
  catatan: z.string().max(500).nullable().optional()
})

// Mirror assertHaidAccess di catatanHaid.ts persis: admin global; KYAI
// SENGAJA diblokir (data sensitif) walau kyai global-read di entity lain;
// kepala_asrama cuma yang asrama putri; ustadz cuma wali kamar putri (via
// ustadz_kamar). Satu-satunya entity yang blokir kyai total dari baris
// individual — beda dari catatan_disiplin/catatan_perkembangan.
async function haidAccessCheck(env: Env, user: UserPayload, row: Record<string, unknown>): Promise<boolean> {
  const santriId = row.santri_id as string | undefined
  if (!santriId) return false
  const santri = await env.DB.prepare(
    'SELECT kamar_id, jenis_kelamin FROM santri WHERE id = ?'
  ).bind(santriId).first<{ kamar_id: string | null; jenis_kelamin: string }>()
  if (!santri) return false
  if (santri.jenis_kelamin !== 'P') return false

  if (user.role === 'admin') return true
  if (user.role === 'kyai') return false
  if (user.role === 'kepala_asrama') return user.asrama_jenis === 'P'

  if (!santri.kamar_id) return false
  const waliKamar = await env.DB.prepare(
    `SELECT uk.user_id FROM ustadz_kamar uk
     JOIN kamar k ON uk.kamar_id = k.id
     WHERE uk.kamar_id = ? AND uk.user_id = ? AND k.jenis_kelamin = 'P'`
  ).bind(santri.kamar_id, user.sub).first()
  return !!waliKamar
}

export const catatanHaidSyncConfig: EntitySyncConfig = {
  entityType: 'catatan_haid',
  table: 'catatan_haid',
  capability: 'full',
  idempotentCreate: false,
  // Natural-key upsert — mirror ON CONFLICT(santri_id, tanggal) yang sudah
  // ada di catatanHaid.ts POST / (upsert per hari).
  naturalKey: ['santri_id', 'tanggal'],
  createColumns: ['santri_id', 'tanggal', 'status', 'catatan'],
  createExtra: (_data, user) => ({ dicatat_oleh: user.sub }),
  createSchema: catatanHaidCreateSchema,
  updateSchema: catatanHaidUpdateSchema,
  writableColumns: ['status', 'catatan'],
  softDelete: { column: 'is_deleted', setValue: 1, excludeFromFetch: true },
  scope: { kind: 'custom', check: haidAccessCheck },
  scopeDeniedCode: 'NOT_WALI_KAMAR_PUTRI',
  notFoundCode: 'CATATAN_NOT_FOUND',
  pull: { timestampColumn: 'updated_at' }
}
