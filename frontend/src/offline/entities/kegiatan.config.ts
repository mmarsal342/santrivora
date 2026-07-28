import { registerEntity, type EntityConfig } from '../registry'

// push-eligible (mirror backend fase 2) — create/update/delete lewat outbox,
// TIDAK ada `service` (tidak dipakai push-eligible, lihat catatan di
// registry.ts). softDelete mirror backend: DELETE cuma set is_active=0.
export const kegiatanEntityConfig: EntityConfig = {
  entityType: 'kegiatan',
  dexieSchema: '&id, kelas_id, kamar_id, tanggal, jadwal_kegiatan_id, is_active, updated_at',
  eligibility: 'push-eligible',
  softDelete: { column: 'is_active', setValue: 0 }
}

registerEntity(kegiatanEntityConfig)
