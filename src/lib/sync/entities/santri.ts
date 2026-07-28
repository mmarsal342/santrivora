import { z } from 'zod'
import { recordSantriKamarChange, closeSantriKamarHistory } from '../../riwayatKamar'
import type { EntitySyncConfig } from '../types'

const santriDataSchema = z.object({
  id: z.string().optional(),
  nama_lengkap: z.string().max(200),
  jenis_kelamin: z.enum(['L', 'P']),
  kelas_id: z.string().uuid().nullable().optional(),
  kamar_id: z.string().uuid().nullable().optional(),
  angkatan: z.string().max(10).nullable().optional(),
  tanggal_masuk: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tanggal_lahir: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['aktif', 'lulus', 'keluar']).optional(),
  foto_url: z.string().max(500).nullable().optional(),
  love_language: z.string().max(200).nullable().optional()
})

export const santriSyncConfig: EntitySyncConfig = {
  entityType: 'santri',
  table: 'santri',
  capability: 'full',
  idempotentCreate: true,
  // 'status' sengaja TIDAK di-insert saat create (biar DB DEFAULT 'aktif' yang berlaku) —
  // beda dari writableColumns (dipakai update+resolve) yang mengizinkan 'status' diubah.
  createColumns: ['nama_lengkap', 'jenis_kelamin', 'kelas_id', 'kamar_id', 'angkatan', 'tanggal_masuk', 'foto_url', 'tanggal_lahir', 'love_language'],
  createSchema: santriDataSchema,
  updateSchema: santriDataSchema.partial(),
  writableColumns: ['nama_lengkap', 'jenis_kelamin', 'kelas_id', 'kamar_id', 'angkatan', 'tanggal_masuk', 'status', 'foto_url', 'tanggal_lahir', 'love_language'],
  softDelete: { column: 'status', setValue: 'keluar' },
  scope: { kind: 'direct-kamar-kelas' },
  scopeDeniedCode: 'SANTRI_NOT_ACCESSIBLE',
  notFoundCode: 'SANTRI_NOT_FOUND',
  refValidations: [
    { column: 'kelas_id', refTable: 'kelas', refActiveColumn: 'is_active', notFoundCode: 'KELAS_NOT_FOUND' },
    {
      column: 'kamar_id',
      refTable: 'kamar',
      refActiveColumn: 'is_active',
      notFoundCode: 'KAMAR_NOT_FOUND',
      // gender-crosscheck bergantung juga pada jenis_kelamin, bukan cuma kamar_id —
      // lihat komentar watchColumns/existenceTrigger di types.ts.
      watchColumns: ['kamar_id', 'jenis_kelamin'],
      crossCheck: (kamarRow, effective) =>
        kamarRow.jenis_kelamin !== effective.jenis_kelamin ? 'KAMAR_GENDER_MISMATCH' : null
    }
  ],
  afterWrite: async (env, action, id, before, after) => {
    if (action === 'create') {
      await recordSantriKamarChange(env, id, null, (after?.kamar_id as string | null) ?? null)
    } else if (action === 'update') {
      await recordSantriKamarChange(env, id, (before?.kamar_id as string | null) ?? null, (after?.kamar_id as string | null) ?? null)
    } else if (action === 'delete') {
      await closeSantriKamarHistory(env, id)
    }
  },
  pull: { timestampColumn: 'updated_at' }
}
