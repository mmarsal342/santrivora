import { z } from 'zod'
import type { EntitySyncConfig } from '../types'

const KATEGORI_OPTIONS = ['Perkembangan', 'Kesehatan', 'Keluarga', 'Sosial', 'Akademik', 'Spiritual'] as const

const catatanPerkembanganCreateSchema = z.object({
  id: z.string().optional(),
  santri_id: z.string().uuid(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kategori: z.enum(KATEGORI_OPTIONS),
  judul: z.string().min(1).max(300),
  catatan: z.string().max(2000).nullable().optional()
})

const catatanPerkembanganUpdateSchema = z.object({
  id: z.string().optional(),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kategori: z.enum(KATEGORI_OPTIONS).optional(),
  judul: z.string().min(1).max(300).optional(),
  catatan: z.string().max(2000).nullable().optional()
})

export const catatanPerkembanganSyncConfig: EntitySyncConfig = {
  entityType: 'catatan_perkembangan',
  table: 'catatan_perkembangan',
  capability: 'full',
  idempotentCreate: false,
  createColumns: ['santri_id', 'tanggal', 'kategori', 'judul', 'catatan'],
  createExtra: (_data, user) => ({ dicatat_oleh: user.sub }),
  createSchema: catatanPerkembanganCreateSchema,
  updateSchema: catatanPerkembanganUpdateSchema,
  writableColumns: ['tanggal', 'kategori', 'judul', 'catatan'],
  softDelete: { column: 'is_deleted', setValue: 1, excludeFromFetch: true },
  // Mirror assertAccess di catatanPerkembangan.ts: admin/kyai global; kepala_
  // asrama by asrama match; ustadz by kelas/kamar. Sama persis pola
  // catatan_disiplin — 'via-santri' langsung reusable tanpa custom check.
  scope: { kind: 'via-santri', santriIdColumn: 'santri_id' },
  scopeDeniedCode: 'NOT_ASSIGNED',
  notFoundCode: 'CATATAN_NOT_FOUND',
  pull: { timestampColumn: 'updated_at' }
}
