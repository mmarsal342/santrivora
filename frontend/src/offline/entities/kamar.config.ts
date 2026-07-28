import { kamarService } from '@/services'
import { registerEntity, type EntityConfig } from '../registry'

// Entity pertama yang terdaftar — mirror backend (fase 5 offline-first: kamar
// masuk sync sebagai pull-only). Dipilih sebagai entity paling simpel buat
// verifikasi Dexie boot (lihat db.ts) sebelum composable generik dibangun di
// fase POC.
export const kamarEntityConfig: EntityConfig = {
  entityType: 'kamar',
  dexieSchema: '&id, jenis_kelamin, is_active, updated_at',
  eligibility: 'pull-only',
  // Mirror kamar.ts DELETE — soft-delete (is_active=0), bukan hard-delete.
  softDelete: { column: 'is_active', setValue: 0 },
  service: {
    list: () => kamarService.list({ status: 'semua' }),
    get: (id) => kamarService.get(id),
    create: (data) => kamarService.create(data as { nama: string; jenis_kelamin: 'L' | 'P'; kapasitas?: number }),
    update: (id, data) => kamarService.update(id, data),
    remove: (id) => kamarService.remove(id)
  },
  responseShape: 'array'
}

registerEntity(kamarEntityConfig)
