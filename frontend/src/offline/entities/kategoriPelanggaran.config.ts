import { kategoriService } from '@/services'
import { registerEntity, type EntityConfig } from '../registry'

// pull-only — admin mengelola kategori lewat kategori.ts REST endpoint biasa
// (requireAdmin). Baru masuk sync backend di fase 22 (kelewat di rollout
// awal, lihat migrasi 018).
export const kategoriPelanggaranEntityConfig: EntityConfig = {
  entityType: 'kategori_pelanggaran',
  dexieSchema: '&id, is_active, updated_at',
  eligibility: 'pull-only',
  // Mirror kategori.ts DELETE — soft-delete (is_active=0), bukan hard-delete.
  softDelete: { column: 'is_active', setValue: 0 },
  service: {
    list: () => kategoriService.list(),
    create: (data) => kategoriService.create(data as { nama: string; deskripsi?: string; urutan_keparahan?: number }),
    update: (id, data) => kategoriService.update(id, data),
    remove: (id) => kategoriService.remove(id)
  },
  responseShape: 'array'
}

registerEntity(kategoriPelanggaranEntityConfig)
