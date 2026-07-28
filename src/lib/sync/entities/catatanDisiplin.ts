import { z } from 'zod'
import type { EntitySyncConfig } from '../types'

const catatanDataSchema = z.object({
  id: z.string().optional(),
  santri_id: z.string().uuid(),
  tipe: z.enum(['pelanggaran', 'prestasi']),
  kategori_id: z.string().uuid().nullable().optional(),
  judul: z.string().max(200),
  deskripsi: z.string().max(2000).nullable().optional(),
  tanggal_kejadian: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tindak_lanjut: z.string().max(1000).nullable().optional(),
  jenis_prestasi: z.string().max(100).nullable().optional()
})

export const catatanDisiplinSyncConfig: EntitySyncConfig = {
  entityType: 'catatan_disiplin',
  table: 'catatan_disiplin',
  capability: 'full',
  idempotentCreate: false,
  createColumns: ['santri_id', 'tipe', 'kategori_id', 'judul', 'deskripsi', 'tanggal_kejadian', 'tindak_lanjut', 'jenis_prestasi'],
  createExtra: (_data, user) => ({ dicatat_oleh: user.sub }),
  requireActiveParent: true,
  createSchema: catatanDataSchema,
  updateSchema: catatanDataSchema.partial(),
  // 'tipe'/'santri_id' sengaja TIDAK writable lewat update/resolve (sama seperti
  // route catatan.ts biasa) — tipe cuma dipakai buat validasi kategori_id.
  writableColumns: ['kategori_id', 'judul', 'deskripsi', 'tanggal_kejadian', 'tindak_lanjut', 'jenis_prestasi'],
  softDelete: { column: 'is_deleted', setValue: 1, excludeFromFetch: true },
  scope: { kind: 'via-santri', santriIdColumn: 'santri_id' },
  scopeDeniedCode: 'SANTRI_NOT_ACCESSIBLE',
  notFoundCode: 'CATATAN_NOT_FOUND',
  refValidations: [
    {
      column: 'kategori_id',
      refTable: 'kategori_pelanggaran',
      refActiveColumn: 'is_active',
      notFoundCode: 'KATEGORI_NOT_FOUND',
      existenceTrigger: 'present',
      // `tipe` SELALU dari current (DB), bukan pernah dari patch client — tipe
      // tidak ada di writableColumns jadi patch.tipe tidak akan pernah terisi;
      // `effective` di sini otomatis jatuh ke current.tipe.
      when: (effective) => effective.tipe === 'pelanggaran'
    }
  ],
  pull: {
    timestampColumn: 'updated_at',
    selectExtra: 'kp.nama as kategori_nama',
    joinExtra: 'LEFT JOIN kategori_pelanggaran kp ON catatan_disiplin.kategori_id = kp.id'
  }
}
