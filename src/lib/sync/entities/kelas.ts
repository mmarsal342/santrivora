import { z } from 'zod'
import type { EntitySyncConfig } from '../types'

// pull-only — admin mengelola kelas lewat kelas.ts REST endpoint biasa
// (butuh online). Offline client dapet data kelas segar buat label/dropdown
// lewat sync/pull, tapi TIDAK bisa menulis kelas lewat /api/sync sama sekali.
const kelasSchema = z.object({
  id: z.string().optional(),
  nama: z.string().max(100),
  tingkatan: z.string().max(50).nullable().optional(),
  tahun_ajaran: z.string().max(20).nullable().optional(),
  is_active: z.number().int().optional()
})

export const kelasSyncConfig: EntitySyncConfig = {
  entityType: 'kelas',
  table: 'kelas',
  capability: 'pull-only',
  createSchema: kelasSchema,
  updateSchema: kelasSchema.partial(),
  writableColumns: ['nama', 'tingkatan', 'tahun_ajaran', 'is_active'],
  // Mirror kelas.ts GET / : admin/kyai global; selain itu (ustadz DAN kepala_
  // asrama, yang tidak punya dimensi kelas) dibatasi user.kelas_ids — kelasColumn
  // 'id' berarti ID KELAS ITU SENDIRI yang dicocokkan ke kelas_ids (bukan kolom
  // kelas_id di baris, kelas gak punya kolom itu). kamarColumn: null — kelas
  // TIDAK PUNYA dimensi kamar sama sekali (bukan sekadar kolom kosong).
  scope: { kind: 'direct-kamar-kelas', kelasColumn: 'id', kamarColumn: null },
  scopeDeniedCode: 'KELAS_NOT_ACCESSIBLE',
  notFoundCode: 'KELAS_NOT_FOUND',
  pull: { timestampColumn: 'updated_at' }
}
