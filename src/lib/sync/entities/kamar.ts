import { z } from 'zod'
import type { EntitySyncConfig } from '../types'

// pull-only — admin/kepala_asrama mengelola kamar lewat kamar.ts REST endpoint
// biasa (butuh online). Offline client dapet data kamar segar buat label/
// dropdown lewat sync/pull, tapi TIDAK bisa menulis kamar lewat /api/sync.
const kamarSchema = z.object({
  id: z.string().optional(),
  nama: z.string().max(100),
  jenis_kelamin: z.enum(['L', 'P']),
  kapasitas: z.number().int().min(0).nullable().optional(),
  is_active: z.number().int().optional()
})

export const kamarSyncConfig: EntitySyncConfig = {
  entityType: 'kamar',
  table: 'kamar',
  capability: 'pull-only',
  createSchema: kamarSchema,
  updateSchema: kamarSchema.partial(),
  writableColumns: ['nama', 'jenis_kelamin', 'kapasitas', 'is_active'],
  // Mirror kamar.ts GET / lewat resolveKamarScope: admin/kyai global; kepala_
  // asrama & ustadz dibatasi ke kamar mereka — kamarColumn 'id' berarti ID
  // KAMAR ITU SENDIRI yang dicocokkan (kamar tidak punya kolom kamar_id).
  // kelasColumn: null — kamar TIDAK PUNYA dimensi kelas sama sekali.
  scope: { kind: 'direct-kamar-kelas', kelasColumn: null, kamarColumn: 'id' },
  scopeDeniedCode: 'KAMAR_NOT_ACCESSIBLE',
  notFoundCode: 'KAMAR_NOT_FOUND',
  pull: { timestampColumn: 'updated_at' }
}
