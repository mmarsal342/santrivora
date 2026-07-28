import { z } from 'zod'
import type { EntitySyncConfig } from '../types'

// pull-only — admin mengelola kategori pelanggaran lewat kategori.ts REST
// endpoint biasa (butuh online, requireAdmin). Offline client dapet data
// kategori segar buat label/dropdown lewat sync/pull. Kelewat di rollout
// awal (seharusnya dipasangkan bareng kelas/kamar) — ditambahkan sekarang
// karena dibutuhkan gelombang 1 migrasi frontend (KategoriListView +
// dropdown kategori di form catatan disiplin).
const kategoriSchema = z.object({
  id: z.string().optional(),
  nama: z.string().max(100),
  deskripsi: z.string().max(500).nullable().optional(),
  urutan_keparahan: z.number().int().min(0).optional(),
  is_active: z.number().int().optional()
})

export const kategoriPelanggaranSyncConfig: EntitySyncConfig = {
  entityType: 'kategori_pelanggaran',
  table: 'kategori_pelanggaran',
  capability: 'pull-only',
  createSchema: kategoriSchema,
  updateSchema: kategoriSchema.partial(),
  writableColumns: ['nama', 'deskripsi', 'urutan_keparahan', 'is_active'],
  // Mirror kategori.ts GET / — TIDAK ADA filter scope sama sekali, semua
  // role yang login bisa lihat semua kategori (cuma admin yang boleh tulis,
  // lewat REST langsung, bukan lewat sini).
  scope: { kind: 'global' },
  scopeDeniedCode: 'KATEGORI_NOT_ACCESSIBLE',
  notFoundCode: 'KATEGORI_NOT_FOUND',
  pull: { timestampColumn: 'updated_at' }
}
